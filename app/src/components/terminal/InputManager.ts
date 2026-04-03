/**
 * InputManager — handles all keyboard input in xterm.js.
 * Operates in 4 modes: normal, processing, permission, ask.
 */

import type { Terminal } from "@xterm/xterm";
import type { TerminalPalette } from "./themes";
import type { PermissionSuggestion, AskQuestionItem } from "../../types";
import { fg, BOLD, DIM, RESET, ERASE_LINE, ERASE_TO_END, cursorColumn, cursorUp, cursorDown, cursorBack, CURSOR_SAVE, CURSOR_RESTORE, buildSpinnerFrames, interpolateColor, randomSpinnerVerb, sanitizePastedText } from "./AnsiUtils";

export type InputMode = "normal" | "processing" | "ask" | "permission";

export interface InputManagerCallbacks {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onPermissionRespond: (toolUseId: string, allow: boolean, suggestions?: PermissionSuggestion[]) => void;
  onAskRespond: (answers: Record<string, string>) => void;
  onAutocomplete: (input: string) => Promise<string[]>;
  onMenuOpen?: (type: "command" | "mention", filter: string, cursorY: number) => void;
  onMenuClose?: () => void;
  onMenuNavigate?: (direction: number) => void;
  onMenuSelect?: () => void;
}

export class InputManager {
  private mode: InputMode = "processing"; // start as processing until inputRequired
  private buffer = "";
  private cursorPos = 0;
  private history: string[] = [];
  private historyIdx = -1;
  private historyStash = ""; // stash current buffer when browsing history

  // Permission state
  private permToolUseId = "";
  private permSuggestions?: PermissionSuggestion[];

  // Ask state
  private askQuestions: AskQuestionItem[] = [];
  private askStep = 0;
  private askAnswers: Record<string, string> = {};
  private askSelected = 0; // currently highlighted option

  // Spinner state
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private spinnerStartTime = 0;
  private spinnerVerb = "Thinking...";
  private spinnerTokenCount = 0;
  private spinnerFrames: string[];
  private static readonly STALL_THRESHOLD = 30_000; // 30s → color shift to red

  // Autocomplete state
  private completionInFlight = false;

  // Command/mention menu state
  menuActive = false;

  // Spinner layout: spinner on line N, cursor on line N+1 (for input below)
  private spinnerOnScreen = false;

  // Output tracking — pauses spinner when output is happening
  private spinnerPauseTimer: ReturnType<typeof setTimeout> | null = null;
  private streamingActive = false;

  // Input line tracking — true when user's prompt line is rendered on screen during processing
  private inputLineOnScreen = false;

  // Wrapped-input tracking — how many physical terminal rows the input occupies
  private inputRows = 1;
  private inputCursorRow = 0; // which physical row (0-indexed) the terminal cursor is on

  // Disposables
  private disposables: { dispose(): void }[] = [];

  constructor(
    private terminal: Terminal,
    private palette: TerminalPalette,
    private callbacks: InputManagerCallbacks,
  ) {
    this.spinnerFrames = buildSpinnerFrames(palette.icons);
    // Intercept keys before xterm processes them (for menu navigation)
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (this.menuActive && ["ArrowUp", "ArrowDown", "Enter", "Escape", "Tab"].includes(e.key)) {
        // Return false → xterm won't handle these keys; they propagate to menu listener
        if (e.key === "ArrowUp") { e.preventDefault(); this.callbacks.onMenuNavigate?.(-1); return false; }
        if (e.key === "ArrowDown") { e.preventDefault(); this.callbacks.onMenuNavigate?.(1); return false; }
        if (e.key === "Enter") { e.preventDefault(); this.callbacks.onMenuSelect?.(); return false; }
        if (e.key === "Tab") { e.preventDefault(); this.callbacks.onMenuSelect?.(); return false; }
        if (e.key === "Escape") { e.preventDefault(); this.closeMenu(); return false; }
      }
      // Prevent xterm from processing Ctrl+V — we handle paste via clipboard API
      if (e.ctrlKey && e.key === "v") return false;
      return true;
    });
    // Capture keyboard input
    this.disposables.push(
      terminal.onData((data) => this.handleData(data)),
      terminal.onKey(({ domEvent }) => this.handleKeyEvent(domEvent)),
    );
    // Show initial spinner + prompt so user sees ❯ immediately
    this.startSpinner();
  }

  // ── Public API ──────────────────────────────────────────────────

  setMode(mode: InputMode): void {
    // Erase all ephemeral content (spinner + input) atomically
    this.suspendAll();
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.spinnerPauseTimer) {
      clearTimeout(this.spinnerPauseTimer);
      this.spinnerPauseTimer = null;
    }
    this.spinnerVerb = "Thinking...";
    this.spinnerTokenCount = 0;
    this.inputLineOnScreen = false;
    this.inputRows = 1;
    this.inputCursorRow = 0;
    this.mode = mode;
    if (mode === "normal") {
      this.renderPrompt();
    } else if (mode === "processing") {
      this.startSpinner();
    }
  }

  getMode(): InputMode {
    return this.mode;
  }

  getBuffer(): string {
    return this.buffer;
  }

  /** Set up permission mode with the tool/suggestions context */
  enterPermissionMode(toolUseId: string, suggestions?: PermissionSuggestion[]): void {
    this.permToolUseId = toolUseId;
    this.permSuggestions = suggestions;
    this.setMode("permission");
  }

  /** Set up ask mode with the questions */
  enterAskMode(questions: AskQuestionItem[]): void {
    this.askQuestions = questions;
    this.askStep = 0;
    this.askAnswers = {};
    this.askSelected = 0;
    this.buffer = "";
    this.cursorPos = 0;
    this.setMode("ask");
    this.renderAskHint();
  }

  /** Reset input tracking state after terminal clear (fullRedraw/resize) */
  resetInputTracking(): void {
    this.inputLineOnScreen = false;
    this.inputRows = 1;
    this.inputCursorRow = 0;
  }

  /** Whether user-typed input is currently visible on screen */
  hasInputOnScreen(): boolean {
    return this.inputLineOnScreen && this.buffer.length > 0;
  }

  updatePalette(palette: TerminalPalette): void {
    this.palette = palette;
    this.spinnerFrames = buildSpinnerFrames(palette.icons);
    if (this.spinnerFrame >= this.spinnerFrames.length) this.spinnerFrame = 0;
  }

  // ── Menu helpers ────────────────────────────────────────────────

  /** Check if buffer triggers a menu and notify XTermView */
  private checkMenuTrigger(): void {
    if (this.mode !== "normal" && this.mode !== "processing") return;
    // Don't show menu during streaming — prompt isn't visible
    if (this.streamingActive) {
      if (this.menuActive) this.closeMenu();
      return;
    }

    if (this.buffer.startsWith("/")) {
      this.menuActive = true;
      this.callbacks.onMenuOpen?.("command", this.buffer, this.getMenuCursorY());
    } else if (this.buffer.includes("@")) {
      const atIdx = this.buffer.lastIndexOf("@");
      // Only trigger on word boundary (start of buffer or preceded by space)
      if (atIdx > 0 && this.buffer[atIdx - 1] !== " ") {
        if (this.menuActive) this.closeMenu();
        return;
      }
      const afterAt = this.buffer.slice(atIdx);
      if (!/\s/.test(afterAt.slice(1)) || afterAt.length <= 1) {
        this.menuActive = true;
        this.callbacks.onMenuOpen?.("mention", afterAt, this.getMenuCursorY());
      } else if (this.menuActive) {
        this.closeMenu();
      }
    } else if (this.menuActive) {
      this.closeMenu();
    }
  }

  /** Pixel Y position below the input's last row, for menu positioning */
  private getMenuCursorY(): number {
    const viewportCursorY = this.terminal.buffer.active.cursorY;
    const rowsBelowCursor = this.inputRows - 1 - this.inputCursorRow;
    const inputBottomRow = viewportCursorY + rowsBelowCursor;
    const containerEl = this.terminal.element;
    const cellHeight = containerEl ? containerEl.clientHeight / this.terminal.rows : 20;
    return (inputBottomRow + 1) * cellHeight;
  }

  /** Close the menu */
  closeMenu(): void {
    if (!this.menuActive) return;
    this.menuActive = false;
    this.callbacks.onMenuClose?.();
  }

  /** Replace buffer with selected menu item text and optionally submit */
  replaceBuffer(text: string, submit: boolean): void {
    this.closeMenu();
    this.buffer = text.replace(/\x1b/g, "");
    this.cursorPos = text.length;
    this.redrawLine();
    if (submit) {
      this.submit();
    }
  }

  /** Called by TerminalRenderer to track streaming state */
  setStreamingActive(active: boolean): void {
    this.streamingActive = active;
    if (active) {
      // Ensure spinner is stopped during streaming
      this.stopSpinner();
    }
  }

  /** Called by TerminalRenderer to update the spinner verb */
  setSpinnerVerb(verb: string): void {
    this.spinnerVerb = verb;
  }

  /** Called by TerminalRenderer to update token count for spinner display */
  setTokenCount(count: number): void {
    this.spinnerTokenCount = count;
  }

  /**
   * Call this whenever the renderer is about to write output.
   * Pauses the spinner so it doesn't conflict with streaming text.
   * Spinner auto-resumes after 600ms of silence (only if not streaming).
   */
  notifyOutput(): void {
    if (this.mode !== "processing") return;
    if (this.spinnerPauseTimer) clearTimeout(this.spinnerPauseTimer);
    this.spinnerPauseTimer = setTimeout(() => {
      this.spinnerPauseTimer = null;
      if (this.mode === "processing" && !this.streamingActive) {
        this.startSpinner();
      }
    }, 600);
  }

  /**
   * Erase all ephemeral content (spinner + input) from terminal so the renderer
   * can write block output cleanly. Returns true if anything was cleared.
   */
  suspendAll(): boolean {
    // Close menu overlay before erasing prompt — overlay would be orphaned
    this.closeMenu();
    const hadInput = this.inputLineOnScreen;
    const hadSpinner = this.spinnerOnScreen;
    if (!hadInput && !hadSpinner) return false;

    // Stop spinner interval and pending restart timer
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.spinnerPauseTimer) {
      clearTimeout(this.spinnerPauseTimer);
      this.spinnerPauseTimer = null;
    }

    // Erase only the rows we own: input rows + spinner row.
    // Use per-line ERASE_LINE instead of ERASE_BELOW to avoid
    // accidentally wiping block content above.
    const totalEphemeralRows = (hadInput ? this.inputRows : 0) + (hadSpinner ? 1 : 0);

    // Move to the topmost ephemeral row
    let rowsUp = 0;
    if (hadInput) rowsUp += this.inputCursorRow;
    if (hadSpinner) rowsUp += 1;
    if (rowsUp > 0) this.terminal.write(cursorUp(rowsUp));

    // Clear each ephemeral row individually
    for (let i = 0; i < totalEphemeralRows; i++) {
      this.terminal.write(`\r${ERASE_LINE}`);
      if (i < totalEphemeralRows - 1) this.terminal.write(cursorDown(1));
    }
    // Return cursor to the topmost ephemeral row (where new content should start)
    if (totalEphemeralRows > 1) {
      this.terminal.write(cursorUp(totalEphemeralRows - 1));
    }
    this.terminal.write("\r");

    this.inputLineOnScreen = false;
    this.inputRows = 1;
    this.inputCursorRow = 0;
    this.spinnerOnScreen = false;
    return true;
  }

  /**
   * Re-render spinner + input after the renderer wrote block output.
   */
  resumeAll(): void {
    if (this.mode !== "processing" || this.streamingActive) return;
    // Restart spinner + input prompt (startSpinner always renders ❯ below)
    this.startSpinner();
  }

  dispose(): void {
    this.stopSpinner();
    if (this.spinnerPauseTimer) {
      clearTimeout(this.spinnerPauseTimer);
      this.spinnerPauseTimer = null;
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ── Data handler (printable chars, paste, special sequences) ────

  private handleData(data: string): void {
    switch (this.mode) {
      case "normal":
        this.handleNormalData(data);
        break;
      case "processing":
        // Allow typing to queue messages while agent is working
        this.handleNormalData(data);
        break;
      case "permission":
        this.handlePermissionData(data);
        break;
      case "ask":
        this.handleAskData(data);
        break;
    }
  }

  /** Key events for special keys that onData doesn't provide cleanly */
  private handleKeyEvent(e: KeyboardEvent): void {
    // Ctrl+Arrow — fast scroll (Up/Down) or word jump (Left/Right)
    if (e.ctrlKey && e.key.startsWith("Arrow")) {
      e.preventDefault();
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const jump = Math.max(1, Math.floor((this.terminal.rows || 24) / 2));
        this.terminal.scrollLines(e.key === "ArrowUp" ? -jump : jump);
      } else if (e.key === "ArrowLeft") {
        // Jump to start of previous word
        let pos = this.cursorPos;
        while (pos > 0 && this.buffer[pos - 1] === " ") pos--;
        while (pos > 0 && this.buffer[pos - 1] !== " ") pos--;
        this.moveCursorTo(pos);
      } else if (e.key === "ArrowRight") {
        // Jump to end of next word
        let pos = this.cursorPos;
        while (pos < this.buffer.length && this.buffer[pos] !== " ") pos++;
        while (pos < this.buffer.length && this.buffer[pos] === " ") pos++;
        this.moveCursorTo(pos);
      }
      return;
    }

    // Ctrl+C: copy selection if any, otherwise clear input / interrupt
    if (e.ctrlKey && e.key === "c") {
      const selection = this.terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).then(() => {
          this.terminal.clearSelection();
        }).catch((err) => console.warn("Clipboard write failed:", err));
        return;
      }
      e.preventDefault();
      if ((this.mode === "normal" || this.mode === "processing") && this.buffer.length > 0) {
        // During streaming, only clear buffer — don't touch terminal
        if (this.streamingActive && this.mode === "processing") {
          this.buffer = "";
          this.cursorPos = 0;
          this.inputLineOnScreen = false;
          this.inputRows = 1;
          this.inputCursorRow = 0;
          return;
        }
        if (this.mode === "processing") {
          // Clear buffer, redraw empty prompt (keep ❯ visible)
          this.buffer = "";
          this.cursorPos = 0;
          this.redrawLine();
        } else {
          // Normal mode: move to end of wrapped text, then new line + prompt
          const endRow = this.inputRows - 1;
          if (this.inputCursorRow < endRow) {
            this.terminal.write(cursorDown(endRow - this.inputCursorRow));
          }
          this.buffer = "";
          this.cursorPos = 0;
          this.inputRows = 1;
          this.inputCursorRow = 0;
          this.terminal.write("\r\n");
          this.renderPrompt();
        }
      } else if (this.mode === "processing" || (this.mode === "normal" && this.buffer.length === 0)) {
        this.callbacks.onInterrupt();
      }
      return;
    }

    // Ctrl+V: paste from clipboard
    if (e.ctrlKey && e.key === "v") {
      e.preventDefault();
      const snapshotMode = this.mode;
      const snapshotBuffer = this.buffer;
      navigator.clipboard.readText().then((text) => {
        if (!text) return;
        // Bail if state changed during async clipboard read
        if (this.mode !== snapshotMode || this.buffer !== snapshotBuffer) return;
        const clean = sanitizePastedText(text);
        if (clean) this.insertText(clean);
      }).catch((err) => console.warn("Clipboard read failed:", err));
      return;
    }
  }

  // ── Normal mode ─────────────────────────────────────────────────

  private handleNormalData(data: string): void {
    // When menu is active, suppress keys that the menu handles
    // (attachCustomKeyEventHandler should prevent these, but guard here too)
    if (this.menuActive) {
      if (data === "\r" || data === "\n") return; // Enter → handled by menu select
      if (data === "\x1b[A" || data === "\x1b[B") return; // Arrow up/down → handled by menu navigate
      if (data === "\x1b") return; // Escape → handled by menu close
      if (data === "\t") return; // Tab → handled by menu select
    }

    // Special sequences
    if (data === "\r" || data === "\n") {
      // Enter — submit
      this.submit();
      return;
    }

    if (data === "\x7f" || data === "\b") {
      // Backspace
      this.backspace();
      return;
    }

    if (data === "\x1b[3~") {
      // Delete key
      this.deleteChar();
      return;
    }

    if (data === "\x1b[D") {
      // Left arrow
      this.moveCursor(-1);
      return;
    }

    if (data === "\x1b[C") {
      // Right arrow
      this.moveCursor(1);
      return;
    }

    if (data === "\x1b[A") {
      // Up arrow — history
      this.historyPrev();
      return;
    }

    if (data === "\x1b[B") {
      // Down arrow — history
      this.historyNext();
      return;
    }

    if (data === "\x1b[H" || data === "\x01") {
      // Home or Ctrl+A
      this.moveCursorTo(0);
      return;
    }

    if (data === "\x1b[F" || data === "\x05") {
      // End or Ctrl+E
      this.moveCursorTo(this.buffer.length);
      return;
    }

    if (data === "\x0b") {
      // Ctrl+K — kill to end of line
      this.buffer = this.buffer.slice(0, this.cursorPos);
      if (this.streamingActive && this.mode === "processing") return; // buffer-only during streaming
      if (this.mode === "processing" && this.buffer.length === 0) {
        this.redrawLine(); // keep ❯ prompt visible
        return;
      }
      // Fast path: single-line — just erase from cursor to end
      if (this.inputRows <= 1) {
        this.terminal.write(ERASE_TO_END);
        return;
      }
      this.redrawLine();
      return;
    }

    if (data === "\x15") {
      // Ctrl+U — clear line
      if (this.streamingActive && this.mode === "processing") {
        this.buffer = "";
        this.cursorPos = 0;
        this.inputRows = 1;
        this.inputCursorRow = 0;
        return; // buffer-only during streaming
      }
      if (this.mode === "processing") {
        this.buffer = "";
        this.cursorPos = 0;
        this.redrawLine(); // keep ❯ prompt visible
        return;
      }
      this.buffer = "";
      this.cursorPos = 0;
      this.redrawLine();
      return;
    }

    if (data === "\x17") {
      // Ctrl+W — delete word backwards
      this.deleteWordBack();
      return;
    }

    if (data === "\t") {
      // Tab — autocomplete
      this.handleTab();
      return;
    }

    // Filter control characters (Ctrl+C \x03, etc.)
    if (data.charCodeAt(0) < 0x20 && data.length === 1) return;

    // Ignore escape sequences
    if (data.startsWith("\x1b")) return;

    // Strip embedded ANSI escapes from pasted text, flatten multiline to single line
    const clean = sanitizePastedText(data);
    if (!clean) return;

    this.insertText(clean);
  }

  private submit(): void {
    this.closeMenu();
    const text = this.buffer.trim();
    this.historyIdx = -1;

    // During streaming, submit silently — don't write to terminal or start spinner
    if (this.streamingActive && this.mode === "processing") {
      this.buffer = "";
      this.cursorPos = 0;
      this.inputLineOnScreen = false;
      this.inputRows = 1;
      this.inputCursorRow = 0;
      if (text) {
        if (this.history.length === 0 || this.history[this.history.length - 1] !== text) {
          this.history.push(text);
          if (this.history.length > 100) this.history.shift();
        }
        this.callbacks.onSubmit(text);
      }
      return;
    }

    if (text) {
      // Add to history (avoid duplicates at top)
      if (this.history.length === 0 || this.history[this.history.length - 1] !== text) {
        this.history.push(text);
        if (this.history.length > 100) this.history.shift();
      }
      const wasProcessing = this.mode === "processing";
      if (!wasProcessing) {
        this.buffer = "";
        this.cursorPos = 0;
        this.inputLineOnScreen = false;
        this.inputRows = 1;
        this.inputCursorRow = 0;
        // Move below the input line — spinner will render here
        this.terminal.write("\r\n");
        this.setMode("processing");
      } else {
        // Queuing while agent is working — suspendAll needs current tracking state
        // to properly erase spinner + input from screen
        this.suspendAll();
        this.buffer = "";
        this.cursorPos = 0;
        this.startSpinner();
      }
      this.callbacks.onSubmit(text);
    } else {
      this.buffer = "";
      this.cursorPos = 0;
      this.inputLineOnScreen = false;
      this.inputRows = 1;
      this.inputCursorRow = 0;
      this.terminal.write("\r\n");
    }
  }

  private insertText(text: string): void {
    // During streaming, only buffer — don't echo to terminal.
    // The renderer will restore the input line when streaming ends.
    if (this.streamingActive && this.mode === "processing") {
      this.buffer = this.buffer.slice(0, this.cursorPos) + text + this.buffer.slice(this.cursorPos);
      this.cursorPos += text.length;
      return;
    }

    // First char during processing — prompt ❯ is already on screen (rendered by startSpinner).
    // Erase it so the full redraw below rewrites with the new buffer content.
    if (this.mode === "processing" && this.buffer.length === 0) {
      if (this.inputLineOnScreen) this.eraseInput();
      this.inputRows = 1;
      this.inputCursorRow = 0;
    } else {
      // Fast path: single-line input that stays single-line — no erase/redraw flicker
      // Guard: only for ASCII — CJK/fullwidth chars occupy 2 terminal columns but
      // have .length === 1, so the width check would be wrong and cause display corruption.
      const cols = this.terminal.cols || 80;
      const newLen = 2 + this.buffer.length + text.length; // "❯ " = 2 visible chars
      const asciiOnly = !/[^\x20-\x7e]/.test(text) && !/[^\x20-\x7e]/.test(this.buffer);
      if (asciiOnly && this.inputRows <= 1 && newLen < cols) {
        if (this.cursorPos === this.buffer.length) {
          // Append at end — just write the new chars
          this.buffer += text;
          this.cursorPos += text.length;
          this.terminal.write(text);
        } else {
          // Middle insert — write inserted text + remainder, erase leftover
          const tail = this.buffer.slice(this.cursorPos);
          this.buffer = this.buffer.slice(0, this.cursorPos) + text + tail;
          this.cursorPos += text.length;
          this.terminal.write(text + tail + ERASE_TO_END + (tail.length > 0 ? cursorBack(tail.length) : ""));
        }
        if (this.mode === "processing") this.inputLineOnScreen = true;
        this.checkMenuTrigger();
        return;
      }
      // Slow path: erase and full redraw (wrapped lines or about to wrap)
      this.eraseInput();
    }

    this.buffer = this.buffer.slice(0, this.cursorPos) + text + this.buffer.slice(this.cursorPos);
    this.cursorPos += text.length;
    this.writeInputLine();
    this.positionInputCursor();
    if (this.mode === "processing") {
      this.inputLineOnScreen = true;
    }
    this.checkMenuTrigger();
  }

  private backspace(): void {
    if (this.cursorPos <= 0) return;
    const wasAtEnd = this.cursorPos === this.buffer.length;
    this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
    this.cursorPos--;
    if (this.streamingActive && this.mode === "processing") { this.checkMenuTrigger(); return; }
    if (this.mode === "processing" && this.buffer.length === 0) {
      this.redrawLine();
      this.checkMenuTrigger();
      return;
    }
    if (this.inputRows <= 1 && !/[^\x20-\x7e]/.test(this.buffer)) {
      if (wasAtEnd) {
        this.terminal.write("\b \b");
      } else {
        const tail = this.buffer.slice(this.cursorPos);
        this.terminal.write("\b" + tail + ERASE_TO_END + (tail.length > 0 ? cursorBack(tail.length) : ""));
      }
      this.checkMenuTrigger();
      return;
    }
    this.redrawLine();
    this.checkMenuTrigger();
  }

  private deleteChar(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.buffer = this.buffer.slice(0, this.cursorPos) + this.buffer.slice(this.cursorPos + 1);
    if (this.streamingActive && this.mode === "processing") { this.checkMenuTrigger(); return; }
    if (this.mode === "processing" && this.buffer.length === 0) {
      this.redrawLine();
      this.checkMenuTrigger();
      return;
    }
    if (this.inputRows <= 1 && !/[^\x20-\x7e]/.test(this.buffer)) {
      const tail = this.buffer.slice(this.cursorPos);
      this.terminal.write(tail + ERASE_TO_END + (tail.length > 0 ? cursorBack(tail.length) : ""));
      this.checkMenuTrigger();
      return;
    }
    this.redrawLine();
    this.checkMenuTrigger();
  }

  private deleteWordBack(): void {
    if (this.cursorPos <= 0) return;
    let pos = this.cursorPos - 1;
    while (pos > 0 && this.buffer[pos] === " ") pos--;
    while (pos > 0 && this.buffer[pos - 1] !== " ") pos--;
    this.buffer = this.buffer.slice(0, pos) + this.buffer.slice(this.cursorPos);
    this.cursorPos = pos;
    if (this.streamingActive && this.mode === "processing") { this.checkMenuTrigger(); return; }
    if (this.mode === "processing" && this.buffer.length === 0) {
      this.redrawLine();
      this.checkMenuTrigger();
      return;
    }
    this.redrawLine();
    this.checkMenuTrigger();
  }

  private moveCursor(delta: number): void {
    const newPos = Math.max(0, Math.min(this.buffer.length, this.cursorPos + delta));
    if (newPos !== this.cursorPos) {
      this.cursorPos = newPos;
      if (!(this.streamingActive && this.mode === "processing")) {
        if (this.inputRows > 1) {
          // Wrapped input — redraw to reposition cursor across rows
          this.redrawLine();
        } else {
          this.terminal.write(cursorColumn(this.cursorPos + 3)); // +3 for "❯ " prompt (2 chars + 1-based column)
        }
      }
    }
  }

  private moveCursorTo(pos: number): void {
    this.cursorPos = Math.max(0, Math.min(this.buffer.length, pos));
    if (!(this.streamingActive && this.mode === "processing")) {
      if (this.inputRows > 1) {
        this.redrawLine();
      } else {
        this.terminal.write(cursorColumn(this.cursorPos + 3));
      }
    }
  }

  private historyPrev(): void {
    if (this.history.length === 0) return;
    if (this.streamingActive && this.mode === "processing") return; // no history during streaming
    if (this.historyIdx === -1) {
      this.historyStash = this.buffer;
      this.historyIdx = this.history.length - 1;
    } else if (this.historyIdx > 0) {
      this.historyIdx--;
    } else {
      return;
    }
    this.buffer = this.history[this.historyIdx];
    this.cursorPos = this.buffer.length;
    this.redrawLine();
  }

  private historyNext(): void {
    if (this.historyIdx === -1) return;
    if (this.streamingActive && this.mode === "processing") return; // no history during streaming
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.buffer = this.history[this.historyIdx];
    } else {
      this.historyIdx = -1;
      this.buffer = this.historyStash;
    }
    this.cursorPos = this.buffer.length;
    this.redrawLine();
  }

  private async handleTab(): Promise<void> {
    if (this.completionInFlight) return;
    const input = this.buffer.slice(0, this.cursorPos);
    if (!input.trim()) return;

    // Extract the last token (after last space)
    const lastSpace = input.lastIndexOf(" ");
    const token = lastSpace >= 0 ? input.slice(lastSpace + 1) : input;
    if (!token) return;

    // Snapshot buffer state to detect changes during async await
    const snapshotBuffer = this.buffer;
    const snapshotCursor = this.cursorPos;

    this.completionInFlight = true;
    try {
      const suggestions = await this.callbacks.onAutocomplete(token);
      // Bail if buffer changed while waiting, or streaming started during await
      if (this.buffer !== snapshotBuffer || this.cursorPos !== snapshotCursor) return;
      if (this.streamingActive && this.mode === "processing") return;
      if (suggestions.length === 0) return;
      if (suggestions.length === 1) {
        // Single match — complete inline
        const completion = suggestions[0].slice(token.length);
        this.insertText(completion);
      } else {
        // Multiple matches — show below prompt, then re-render prompt below suggestions
        // Reset row tracking: old prompt scrolls into history, cursor is on a fresh line
        this.inputRows = 1;
        this.inputCursorRow = 0;
        this.terminal.write("\r\n");
        const cols = this.terminal.cols;
        const maxLen = Math.max(...suggestions.map(s => s.length)) + 2;
        const perRow = Math.max(1, Math.floor(cols / maxLen));
        for (let i = 0; i < suggestions.length; i++) {
          this.terminal.write(`${DIM}${suggestions[i].padEnd(maxLen)}${RESET}`);
          if ((i + 1) % perRow === 0 && i + 1 < suggestions.length) {
            this.terminal.write("\r\n");
          }
        }
        this.terminal.write("\r\n");
        // Find common prefix for partial completion
        const common = commonPrefix(suggestions);
        if (common.length > token.length) {
          this.inputRows = 1;
          this.inputCursorRow = 0;
          this.insertText(common.slice(token.length));
        } else {
          this.renderPrompt();
        }
      }
    } catch {
      // Autocomplete failed silently
    } finally {
      this.completionInFlight = false;
    }
  }

  // ── Prompt rendering ────────────────────────────────────────────

  renderPrompt(): void {
    this.eraseInput();
    this.writeInputLine();
    this.positionInputCursor();
  }

  private redrawLine(): void {
    if (this.streamingActive && this.mode === "processing") return; // suppress during streaming
    this.eraseInput();
    this.writeInputLine();
    this.positionInputCursor();
    if (this.mode === "processing") {
      this.inputLineOnScreen = true;
    }
  }

  /** Erase all physical rows the current input occupies (handles wrapped text) */
  private eraseInput(): void {
    if (this.inputCursorRow > 0) {
      this.terminal.write(cursorUp(this.inputCursorRow));
    }
    // Clear only the input rows, not everything below (prevents wiping block content)
    for (let i = 0; i < this.inputRows; i++) {
      this.terminal.write(`\r${ERASE_LINE}`);
      if (i < this.inputRows - 1) this.terminal.write(cursorDown(1));
    }
    if (this.inputRows > 1) {
      this.terminal.write(cursorUp(this.inputRows - 1));
    }
    this.terminal.write("\r");
    this.inputRows = 1;
    this.inputCursorRow = 0;
  }

  /** Write prompt + buffer to the terminal and update row tracking */
  private writeInputLine(): void {
    const prompt = `${fg(this.palette.accent)}${BOLD}${this.palette.icons.prompt}${RESET} `;
    this.terminal.write(`${prompt}${this.buffer}`);
    const cols = this.terminal.cols || 80;
    const N = 2 + this.buffer.length; // "❯ " = 2 visible chars
    this.inputRows = Math.max(1, Math.ceil(N / cols));
    // After writing N chars, cursor row depends on whether N fills the row exactly
    // When N is an exact multiple of cols, xterm wraps cursor to column 0 of next row
    this.inputCursorRow = N > 0 && N % cols === 0 ? N / cols : Math.floor(N / cols);
    // Ensure inputRows accounts for cursor-wrap row
    if (this.inputCursorRow >= this.inputRows) {
      this.inputRows = this.inputCursorRow + 1;
    }
  }

  /** Position cursor within wrapped input (after writeInputLine) */
  private positionInputCursor(): void {
    if (this.cursorPos >= this.buffer.length) return; // already at end
    const cols = this.terminal.cols || 80;
    const targetRow = Math.floor((2 + this.cursorPos) / cols);
    const rowsUp = this.inputCursorRow - targetRow;
    if (rowsUp > 0) this.terminal.write(cursorUp(rowsUp));
    this.terminal.write(cursorColumn(((2 + this.cursorPos) % cols) + 1));
    this.inputCursorRow = targetRow;
  }

  // ── Processing mode (spinner) ───────────────────────────────────

  private startSpinner(): void {
    // Clear any existing spinner to prevent stacking
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.spinnerOnScreen = false;
    if (this.spinnerPauseTimer) {
      clearTimeout(this.spinnerPauseTimer);
      this.spinnerPauseTimer = null;
    }
    this.spinnerFrame = 0;
    this.spinnerStartTime = Date.now();
    // Pick a random verb if we don't have a specific one set by the renderer
    if (this.spinnerVerb === "Thinking..." || this.spinnerVerb === "") {
      this.spinnerVerb = randomSpinnerVerb();
    }
    this.renderSpinner();
    this.spinnerInterval = setInterval(() => {
      if (this.spinnerInterval === null) return; // stale callback guard
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerFrames.length;
      this.renderSpinner();
    }, 50);
    // Always show input prompt below spinner so user knows they can type
    this.writeInputLine();
    this.positionInputCursor();
    this.inputLineOnScreen = true;
  }

  private renderSpinner(): void {
    const elapsedMs = Date.now() - this.spinnerStartTime;
    const elapsed = Math.floor(elapsedMs / 1000);
    const frame = this.spinnerFrames[this.spinnerFrame];

    // Stall detection: after 30s, interpolate accent → red
    const stallT = elapsedMs > InputManager.STALL_THRESHOLD
      ? Math.min(1, (elapsedMs - InputManager.STALL_THRESHOLD) / 30_000)
      : 0;
    const color = stallT > 0
      ? interpolateColor(this.palette.accent, this.palette.red, stallT)
      : this.palette.accent;

    // Format elapsed time: use h/m/s for long durations
    let timeStr = "";
    if (elapsed > 0) {
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      const formatted = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      timeStr = ` ${DIM}· ${formatted}${RESET}`;
    }
    // Token count after 30s
    const tokenStr = elapsedMs > InputManager.STALL_THRESHOLD && this.spinnerTokenCount > 0
      ? ` ${DIM}· \u2193 ${(this.spinnerTokenCount / 1000).toFixed(1)}k${RESET}`
      : "";
    const spinnerLine = `\r${ERASE_LINE}  ${fg(color)}${frame}${RESET} ${DIM}${this.spinnerVerb}${RESET}${timeStr}${tokenStr}`;

    if (this.spinnerOnScreen) {
      // Cursor is on the line BELOW the spinner — go up, update, come back
      const inputBelow = this.inputLineOnScreen ? this.inputCursorRow + 1 : 1;
      this.terminal.write(CURSOR_SAVE + cursorUp(inputBelow) + spinnerLine + CURSOR_RESTORE);
    } else {
      // First frame: write spinner, move cursor to line below
      this.terminal.write(spinnerLine + "\r\n");
      this.spinnerOnScreen = true;
    }
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    // Don't write erase sequences here — suspendAll() handles cleanup.
    // Just clear the flag; the spinner content stays until suspendAll erases it.
    this.spinnerOnScreen = false;
  }

  // ── Permission mode ─────────────────────────────────────────────

  private handlePermissionData(data: string): void {
    const key = data.toLowerCase();
    if (key === "y" || data === "\r") {
      this.callbacks.onPermissionRespond(this.permToolUseId, true);
      this.setMode("processing");
    } else if (key === "n" || data === "\x1b") {
      this.callbacks.onPermissionRespond(this.permToolUseId, false);
      this.setMode("processing");
    } else if (key === "a" && this.permSuggestions?.length) {
      this.callbacks.onPermissionRespond(this.permToolUseId, true, this.permSuggestions);
      this.setMode("processing");
    }
  }

  // ── Ask mode ────────────────────────────────────────────────────

  private renderAskHint(): void {
    const q = this.askQuestions[this.askStep];
    if (!q) return;
    if (q.options.length > 0) {
      const maxKey = Math.min(q.options.length, 9);
      const extra = q.options.length > 9 ? ", arrows for more" : "";
      const hint = `  ${DIM}Press 1-${maxKey} to select${extra}, Enter to confirm${RESET}`;
      this.terminal.write(hint);
    } else {
      // Free-text question — show input prompt
      const prompt = `${fg(this.palette.accent)}${BOLD}${this.palette.icons.prompt}${RESET} `;
      this.terminal.write(`\r\n${prompt}`);
    }
  }

  private handleAskData(data: string): void {
    const q = this.askQuestions[this.askStep];
    if (!q) return;

    // Free-text question (no options) — allow typing
    if (q.options.length === 0) {
      if (data === "\r" || data === "\n") {
        const text = this.buffer.trim();
        if (!text) return; // Don't submit empty answer
        this.askAnswers[String(this.askStep)] = text;
        this.terminal.write("\r\n");
        this.buffer = "";
        this.cursorPos = 0;
        this.advanceAskStep();
        return;
      }
      if (data === "\x7f" || data === "\b") {
        if (this.cursorPos > 0) {
          this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
          this.cursorPos--;
          this.redrawLine();
        }
        return;
      }
      // Filter control chars and escape sequences
      if (data.charCodeAt(0) < 0x20 && data.length === 1) return;
      if (data.startsWith("\x1b")) return;
      const clean = sanitizePastedText(data);
      if (!clean) return;
      this.insertText(clean);
      return;
    }

    // Number keys select option
    const num = parseInt(data, 10);
    if (num >= 1 && num <= q.options.length) {
      this.askSelected = num - 1;
      this.askAnswers[String(this.askStep)] = q.options[this.askSelected].label;
      this.advanceAskStep();
      return;
    }

    // Enter confirms current selection
    if (data === "\r" || data === "\n") {
      this.askAnswers[String(this.askStep)] = q.options[this.askSelected].label;
      this.advanceAskStep();
      return;
    }

    // Arrow keys navigate options
    if (data === "\x1b[A" && this.askSelected > 0) {
      this.askSelected--;
      return;
    }
    if (data === "\x1b[B" && this.askSelected < q.options.length - 1) {
      this.askSelected++;
      return;
    }
  }

  private advanceAskStep(): void {
    this.askStep++;
    if (this.askStep >= this.askQuestions.length) {
      // All questions answered
      this.callbacks.onAskRespond(this.askAnswers);
      this.setMode("processing");
    } else {
      this.askSelected = 0;
      this.buffer = "";
      this.cursorPos = 0;
      this.renderAskHint();
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}
