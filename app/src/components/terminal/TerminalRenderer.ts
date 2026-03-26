/**
 * TerminalRenderer — writes Block content to xterm.js.
 * Handles appending new blocks, in-place updates, streaming, and full redraws.
 *
 * Streaming safety: while a streaming block is active, in-place updates are
 * deferred and the spinner is suppressed, because cursor positioning is
 * unreliable (totalLines doesn't track streamed text).
 */

import type { Terminal } from "@xterm/xterm";
import type { Block } from "./blocks/Block";
import type { UserBlock } from "./blocks/UserBlock";
import type { TerminalDocument, DocumentEvent } from "./TerminalDocument";
import type { TerminalPalette } from "./themes";
import type { InputManager } from "./InputManager";
import { CURSOR_SAVE, CURSOR_RESTORE, cursorUp, ERASE_LINE, sanitizeAgentText } from "./AnsiUtils";

export class TerminalRenderer {
  private cols: number;
  private rows: number;
  private unsubscribe: (() => void) | null = null;
  private inputManager: InputManager | null = null;
  /** True while a streaming assistant block is active */
  private streamingActive = false;
  /** Blocks whose updates were deferred during streaming */
  private deferredUpdates: Block[] = [];

  constructor(
    private terminal: Terminal,
    private document: TerminalDocument,
    private palette: TerminalPalette,
  ) {
    this.cols = terminal.cols;
    this.rows = terminal.rows;
    this.subscribe();
  }

  // ── InputManager link ─────────────────────────────────────────

  setInputManager(im: InputManager): void {
    this.inputManager = im;
  }

  // ── Palette management ──────────────────────────────────────────

  updatePalette(palette: TerminalPalette): void {
    this.palette = palette;
  }

  // ── Event subscription ──────────────────────────────────────────

  private subscribe(): void {
    this.unsubscribe = this.document.subscribe((event) => {
      this.handleDocumentEvent(event);
    });
  }

  private handleDocumentEvent(event: DocumentEvent): void {
    switch (event.type) {
      case "blockAdded":
        this.onBlockAdded(event.block);
        break;
      case "blockUpdated":
        this.onBlockUpdated(event.block);
        break;
      case "streamAppend":
        this.writeStreaming(event.text);
        break;
      case "streamEnd":
        this.onStreamEnd();
        break;
      case "thinkingAppend":
        this.onBlockUpdated(event.block);
        break;
      case "cleared":
        this.terminal.clear();
        this.terminal.write("\x1b[H\x1b[2J");
        break;
    }
  }

  // ── Block rendering ─────────────────────────────────────────────

  private onBlockAdded(block: Block): void {
    // Live user input already echoed by InputManager — just track it, no output written
    if (block.type === "user" && !(block as UserBlock).fromHistory) {
      // Use render() + count \r\n for correct line count (handles wide chars, wrapping)
      const content = block.render(this.cols, this.palette);
      const visualLines = (content.match(/\r\n/g) || []).length || 1;
      this.document.commitBlockLines(block, visualLines);
      return;
    }

    this.inputManager?.notifyOutput();

    // Streaming assistant block: don't render yet, text comes via streamAppend
    if (block.type === "assistant" && (block as { streaming?: boolean }).streaming) {
      this.streamingActive = true;
      this.inputManager?.setStreamingActive(true);
      this.document.commitBlockLines(block, 0);
      return;
    }

    this.renderBlock(block);
  }

  private renderBlock(block: Block): void {
    const content = block.render(this.cols, this.palette);
    this.terminal.write(content);
    const lineCount = (content.match(/\r\n/g) || []).length;
    this.document.commitBlockLines(block, lineCount);
  }

  /** Handle block update — defer if streaming is active */
  private onBlockUpdated(block: Block): void {
    this.inputManager?.notifyOutput();

    if (this.streamingActive) {
      // Defer update — cursor position is unreliable during streaming
      if (!this.deferredUpdates.includes(block)) {
        this.deferredUpdates.push(block);
      }
      return;
    }

    this.updateBlock(block);
  }

  /** In-place update of an existing block (if still in viewport) */
  private updateBlock(block: Block): void {
    if (block.frozen) return;

    const totalLines = this.document.getTotalLines();
    const blockEnd = block.startLine + block.lineCount;
    const linesFromBottom = totalLines - blockEnd;

    if (linesFromBottom > this.rows * 2) {
      block.frozen = true;
      return;
    }

    const oldLineCount = block.lineCount;
    if (oldLineCount === 0) return;

    const newContent = block.render(this.cols, this.palette);
    const newLineCount = (newContent.match(/\r\n/g) || []).length;

    // If line count changed, fall back to partial redraw from this block onwards
    if (newLineCount !== oldLineCount) {
      this.redrawFrom(block);
      return;
    }

    // Same line count — safe to do in-place cursor update
    this.terminal.write(CURSOR_SAVE);

    const linesToMoveUp = linesFromBottom + oldLineCount;
    if (linesToMoveUp > 0) {
      this.terminal.write(cursorUp(linesToMoveUp));
    }

    for (let i = 0; i < oldLineCount; i++) {
      this.terminal.write(`${ERASE_LINE}\r\n`);
    }
    if (oldLineCount > 0) {
      this.terminal.write(cursorUp(oldLineCount));
    }

    this.terminal.write(newContent);
    this.document.commitBlockLines(block, newLineCount);
    this.terminal.write(CURSOR_RESTORE);
  }

  /** Redraw from a specific block onwards (when line count changes) */
  private redrawFrom(startBlock: Block): void {
    // Find the block index
    const blocks = this.document.getBlocks();
    let startIdx = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === startBlock.id) { startIdx = i; break; }
    }
    if (startIdx < 0) return;

    // Calculate lines to erase from startBlock to bottom
    const totalLines = this.document.getTotalLines();
    const linesToErase = totalLines - startBlock.startLine;

    // Move cursor to start of the block
    if (linesToErase > 0) {
      this.terminal.write(cursorUp(linesToErase));
    }
    for (let i = 0; i < linesToErase; i++) {
      this.terminal.write(`${ERASE_LINE}\r\n`);
    }
    if (linesToErase > 0) {
      this.terminal.write(cursorUp(linesToErase));
    }

    // Re-render from startBlock onwards
    let currentLine = startBlock.startLine;
    for (let i = startIdx; i < blocks.length; i++) {
      const b = blocks[i];
      b.startLine = currentLine;
      b.frozen = false;
      const content = b.render(this.cols, this.palette);
      this.terminal.write(content);
      const lineCount = (content.match(/\r\n/g) || []).length;
      this.document.commitBlockLines(b, lineCount);
      currentLine += lineCount;
    }
  }

  /** Write streaming text directly to terminal (sanitized) */
  private writeStreaming(text: string): void {
    this.inputManager?.notifyOutput();
    const sanitized = sanitizeAgentText(text);
    const xtermText = sanitized.replace(/\n/g, "\r\n");
    this.terminal.write(xtermText);
  }

  /** Called when streaming ends */
  private onStreamEnd(): void {
    this.streamingActive = false;
    this.inputManager?.setStreamingActive(false);
    this.terminal.write("\r\n");

    // Flush deferred updates
    const deferred = this.deferredUpdates.splice(0);
    for (const block of deferred) {
      this.updateBlock(block);
    }
  }

  // ── Full redraw ─────────────────────────────────────────────────

  fullRedraw(): void {
    // If streaming, finalize the streaming block first so render() has full text
    if (this.streamingActive) {
      this.document.forceFinalize();
      this.streamingActive = false;
      this.inputManager?.setStreamingActive(false);
      this.deferredUpdates = [];
    }

    this.terminal.clear();
    this.terminal.write("\x1b[H\x1b[2J");

    let currentLine = 0;
    for (const block of this.document.getBlocks()) {
      block.startLine = currentLine;
      block.frozen = false;
      const content = block.render(this.cols, this.palette);
      this.terminal.write(content);
      const lineCount = (content.match(/\r\n/g) || []).length;
      this.document.commitBlockLines(block, lineCount);
      currentLine += lineCount;
    }
  }

  // ── Resize handling ─────────────────────────────────────────────

  handleResize(cols: number, rows: number): void {
    const oldCols = this.cols;
    this.cols = cols;
    this.rows = rows;
    if (cols !== oldCols) {
      this.fullRedraw();
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
