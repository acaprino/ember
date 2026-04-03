/**
 * XTermView — xterm.js-based terminal view that replaces TerminalView.
 * Uses a Virtual Document Model (TerminalDocument + TerminalRenderer)
 * to render structured AgentEvents as ANSI-formatted terminal output.
 * InputManager handles all keyboard input directly in xterm.js.
 */
import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import "./TerminalView.css";

import { PERM_MODES } from "../types";
import type { SessionViewProps } from "./SessionViewProps";
import type { Theme, Attachment } from "../types";
import { themeColorsToXterm, themeColorsToPalette, defaultPalette } from "./terminal/themes";
import { TerminalRenderer } from "./terminal/TerminalRenderer";
import { InputManager } from "./terminal/InputManager";
import type { PermissionBlock } from "./terminal/blocks/PermissionBlock";
import { useThemes } from "../contexts/ThemesContext";
import { useProjectsContext } from "../contexts/ProjectsContext";
import { fmtTokens } from "../utils/format";
import RightSidebar from "./chat/RightSidebar";
import SessionPanel from "./SessionPanel";
import { IconPlus, IconSidebar } from "./Icons";

export default memo(function XTermView(props: SessionViewProps) {
  const {
    modelIdx, effortIdx, permModeIdx, isActive,
    controller: ctrl,
    onConfigChange,
    sessionPanelOpen, onCloseSessionPanel, onResumeSession, onForkSession,
  } = props;

  const {
    deferredMessages,
    inputState, stats, agentTasks,
    thinkingIdRef,
    handleSubmit, handlePermissionRespond, handleAskUserRespond,
    handleInterrupt,
    handleAttachClick,
    queueLength, backgrounded,
    document: termDocument,
    projectPath,
    models, efforts,
    sdkCommands, sdkAgents,
  } = ctrl;

  const themes = useThemes();
  const { settings } = useProjectsContext();
  const themeIdx = settings?.theme_idx ?? 1;
  const currentTheme: Theme | undefined = themes[themeIdx] ?? themes[0];
  const currentThemeRef = useRef(currentTheme);
  currentThemeRef.current = currentTheme;

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Command/mention menu state ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuType, setMenuType] = useState<"command" | "mention">("command");
  const [menuFilter, setMenuFilter] = useState("");
  const [menuSelectedIdx, setMenuSelectedIdx] = useState(0);
  const menuTopRef = useRef(0);

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const nullScrollRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const inputManagerRef = useRef<InputManager | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const inputStateRef = useRef(inputState);
  inputStateRef.current = inputState;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Stable callback refs to avoid stale closures in InputManager
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  const handleInterruptRef = useRef(handleInterrupt);
  handleInterruptRef.current = handleInterrupt;
  const handlePermissionRespondRef = useRef(handlePermissionRespond);
  handlePermissionRespondRef.current = handlePermissionRespond;
  const handleAskUserRespondRef = useRef(handleAskUserRespond);
  handleAskUserRespondRef.current = handleAskUserRespond;
  const menuSelectRef = useRef<(() => void) | null>(null);

  // ── Initialize xterm.js + Document + Renderer + InputManager ──
  useEffect(() => {
    if (!containerRef.current) return;

    const theme = currentThemeRef.current;
    const fontFamily = theme?.termFont
      ? `"${theme.termFont}", "Consolas", monospace`
      : '"Consolas", monospace';
    const fontSize = theme?.termFontSize || 14;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily,
      fontSize,
      lineHeight: 1.2,
      scrollback: 10000,
      allowProposedApi: true,
      theme: theme ? themeColorsToXterm(theme.colors) : undefined,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const unicodeAddon = new Unicode11Addon();
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = "11";

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    // WebGL addon — only load for active tab to avoid context exhaustion (limit ~16)
    if (isActiveRef.current) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddonRef.current = null; });
        term.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch {
        console.warn("XTermView: WebGL addon failed, using canvas renderer");
      }
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create Renderer using the document from useSessionController (already exists)
    const palette = currentTheme
      ? themeColorsToPalette(currentTheme.colors, currentTheme)
      : defaultPalette();

    const renderer = new TerminalRenderer(term, termDocument, palette);
    rendererRef.current = renderer;

    // Create InputManager and link to renderer
    const inputManager = new InputManager(term, palette, {
      onSubmit: (text) => {
        handleSubmitRef.current(text, [] as Attachment[]);
      },
      onInterrupt: () => {
        handleInterruptRef.current();
      },
      onPermissionRespond: (toolUseId, allow, suggestions) => {
        const block = termDocument.findLastUnresolvedPermission();
        if (block) {
          handlePermissionRespondRef.current(block.id, allow, suggestions);
          termDocument.resolvePermission(toolUseId, allow);
        }
      },
      onAskRespond: (answers) => {
        const block = termDocument.findLastUnresolvedAsk();
        if (block) {
          handleAskUserRespondRef.current(block.id, answers);
          termDocument.resolveAsk(answers);
        }
      },
      onAutocomplete: async (input) => {
        try {
          return await invoke<string[]>("autocomplete_files", { cwd: projectPath || "D:\\Projects", input });
        } catch {
          return [];
        }
      },
      onMenuOpen: (type, filter, cursorY) => {
        setMenuType(type);
        setMenuFilter(filter);
        menuTopRef.current = cursorY;
        setMenuOpen(true);
        setMenuSelectedIdx(0);
      },
      onMenuClose: () => {
        setMenuOpen(false);
      },
      onMenuNavigate: (dir) => {
        setMenuSelectedIdx(prev => Math.max(0, prev + dir));
      },
      onMenuSelect: () => {
        // Handled by the menu render logic below via menuSelectRef
        menuSelectRef.current?.();
      },
    });
    inputManagerRef.current = inputManager;
    renderer.setInputManager(inputManager);

    // Listen to document events for mode switching
    const unsub = termDocument.subscribe((event) => {
      if (event.type === "blockAdded") {
        const b = event.block;
        if (b.type === "permission" && !(b as PermissionBlock).resolved) {
          inputManager.enterPermissionMode(
            (b as PermissionBlock).toolUseId,
            (b as PermissionBlock).suggestions,
          );
        } else if (b.type === "ask") {
          const askBlock = b as import("./terminal/blocks/AskBlock").AskBlock;
          if (!askBlock.resolved) {
            inputManager.enterAskMode(askBlock.questions);
            if (isActiveRef.current) term.focus();
          }
        }
      }
    });

    // Resize handler
    term.onResize(({ cols, rows }) => {
      rendererRef.current?.handleResize(cols, rows);
    });

    return () => {
      unsub();
      inputManager.dispose();
      inputManagerRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
      if (webglAddonRef.current) { webglAddonRef.current.dispose(); webglAddonRef.current = null; }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // Mount once

  // ── Sync inputState -> InputManager mode ──
  useEffect(() => {
    const im = inputManagerRef.current;
    if (!im) return;
    // Don't override permission/ask modes
    if (im.getMode() === "permission" || im.getMode() === "ask") return;

    if (inputState === "awaiting_input") {
      im.setMode("normal");
    } else if (inputState === "processing" || inputState === "idle") {
      // Don't re-enter processing mode — avoids resetting spinner/pause state
      if (im.getMode() !== "processing") {
        im.setMode("processing");
      }
    }
  }, [inputState]);

  // ── Theme updates ──
  useEffect(() => {
    if (!termRef.current || !currentTheme) return;
    termRef.current.options.theme = themeColorsToXterm(currentTheme.colors);
    if (currentTheme.termFont) {
      termRef.current.options.fontFamily = `"${currentTheme.termFont}", "Consolas", monospace`;
    }
    if (currentTheme.termFontSize) {
      termRef.current.options.fontSize = currentTheme.termFontSize;
    }
    const newPalette = themeColorsToPalette(currentTheme.colors, currentTheme);
    if (rendererRef.current) {
      rendererRef.current.updatePalette(newPalette);
      rendererRef.current.fullRedraw();
    }
    if (inputManagerRef.current) {
      inputManagerRef.current.updatePalette(newPalette);
    }
    fitAddonRef.current?.fit();
  }, [currentTheme]);

  // ── Resize handling ──
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;
    const ro = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
      // Close menu on resize — menuTop position would be stale
      inputManagerRef.current?.closeMenu();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Sidebar toggle ──
  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  // ── Auto-open sidebar when team becomes active ──
  // Intentionally omits sidebarOpen from deps: we only want to react to
  // teamState.active transitioning to true, not re-run when the user toggles the sidebar.
  const teamAutoOpened = useRef(false);
  useEffect(() => {
    if (ctrl.teamState?.active) {
      if (!teamAutoOpened.current) {
        teamAutoOpened.current = true;
        setSidebarOpen(true);
      }
    } else {
      teamAutoOpened.current = false;
    }
  }, [ctrl.teamState?.active]);

  // ── WebGL addon lifecycle: load when active, dispose when inactive to prevent context exhaustion ──
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (isActive && !webglAddonRef.current) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddonRef.current = null; });
        term.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch {
        // canvas2d fallback is fine
      }
    } else if (!isActive && webglAddonRef.current) {
      webglAddonRef.current.dispose();
      webglAddonRef.current = null;
    }
  }, [isActive]);

  // ── Auto-focus xterm when tab becomes active ──
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus();
    }
  }, [isActive]);

  // ── Keyboard shortcuts (global, not captured by xterm) ──
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, toggleSidebar]);

  // ── Command/mention menu items ──
  const LOCAL_COMMANDS = useMemo(() => [
    { name: "/clear", desc: "Clear chat messages" },
    { name: "/compact", desc: "Summarize conversation" },
    { name: "/help", desc: "Show help" },
    { name: "/login", desc: "Authenticate with Anthropic" },
    { name: "/status", desc: "Show auth & connection status" },
    { name: "/doctor", desc: "Diagnose configuration issues" },
  ], []);

  const menuSections = useMemo(() => {
    if (!menuOpen) return [];
    if (menuType === "command") {
      const filter = menuFilter.replace(/^\//, "").toLowerCase();
      const local = LOCAL_COMMANDS.filter(c => c.name.includes(filter) || c.desc.toLowerCase().includes(filter));
      const sdk = (sdkCommands || [])
        .filter(c => !LOCAL_COMMANDS.some(l => l.name === "/" + c.name))
        .filter(c => !filter || c.name.includes(filter) || c.description.toLowerCase().includes(filter))
        .map(c => ({ name: "/" + c.name, desc: c.description.split(".")[0] })); // truncate to first sentence
      const sections: { label: string; items: { name: string; desc: string }[] }[] = [];
      if (local.length) sections.push({ label: "Claude Code GUI", items: local });
      if (sdk.length) sections.push({ label: "Skills", items: sdk });
      return sections;
    }
    // mention
    const filter = menuFilter.replace(/^@/, "").toLowerCase();
    const agents = (sdkAgents || [])
      .filter(a => !filter || a.name.toLowerCase().includes(filter) || (a.description || "").toLowerCase().includes(filter))
      .map(a => ({ name: "@" + a.name, desc: a.description || "" }));
    return agents.length ? [{ label: "Agents", items: agents }] : [];
  }, [menuOpen, menuType, menuFilter, sdkCommands, sdkAgents, LOCAL_COMMANDS]);

  // Flatten sections into a single selectable list
  const menuItems = useMemo(() => menuSections.flatMap(s => s.items), [menuSections]);

  // Clamp selected index — also reset state when list shrinks
  const clampedIdx = Math.min(menuSelectedIdx, Math.max(0, menuItems.length - 1));
  useEffect(() => {
    if (menuItems.length > 0 && menuSelectedIdx >= menuItems.length) {
      setMenuSelectedIdx(Math.max(0, menuItems.length - 1));
    }
  }, [menuItems.length, menuSelectedIdx]);

  // Wire menuSelect ref — called by InputManager's onMenuSelect callback
  menuSelectRef.current = () => {
    if (menuItems.length === 0) return;
    const idx = Math.min(menuSelectedIdx, menuItems.length - 1);
    const item = menuItems[idx];
    if (!item) return; // safety guard
    const im = inputManagerRef.current;
    if (!im) return;
    if (menuType === "command") {
      // Commands: replace buffer with command text and submit
      im.replaceBuffer(item.name, true);
    } else {
      // Mentions: replace @filter with @name + space, don't submit
      const atIdx = im.getBuffer().lastIndexOf("@");
      const before = im.getBuffer().slice(0, atIdx);
      im.replaceBuffer(before + item.name + " ", false);
    }
  };

  return (
    <div className="tv-wrapper">
      <div className="tv-main-row">
        <div
          ref={containerRef}
          className="xterm-container"
          style={{ flex: 1, overflow: "hidden", position: "relative" }}
        >
          {/* Command/mention menu overlay — positioned inline below cursor */}
          {menuOpen && menuItems.length > 0 && (() => {
            const containerH = containerRef.current?.clientHeight ?? 600;
            const maxH = 280;
            const top = menuTopRef.current;
            const spaceBelow = containerH - top;
            const flipAbove = spaceBelow < Math.min(maxH, 120);
            const menuStyle: React.CSSProperties = flipAbove
              ? { bottom: containerH - top + 4, maxHeight: Math.min(maxH, top - 8) }
              : { top: top + 4, maxHeight: Math.min(maxH, spaceBelow - 8) };
            return (
            <div className="terminal-menu" role="listbox" style={menuStyle}>
              {menuSections.map((section) => {
                const sectionStartIdx = menuItems.indexOf(section.items[0]);
                return (
                  <div key={section.label}>
                    <div className="tm-section">
                      <span className="tm-rule" />
                      <span>{section.label}</span>
                      <span className="tm-rule" />
                    </div>
                    {section.items.map((item, si) => {
                      const globalIdx = sectionStartIdx + si;
                      return (
                        <div
                          key={item.name}
                          className={`tm-item${globalIdx === clampedIdx ? " selected" : ""}`}
                          role="option"
                          aria-selected={globalIdx === clampedIdx}
                          ref={globalIdx === clampedIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                          onClick={() => { setMenuSelectedIdx(globalIdx); menuSelectRef.current?.(); }}
                          onMouseEnter={() => setMenuSelectedIdx(globalIdx)}
                        >
                          <span className="tm-indicator">&gt;</span>
                          <span className="tm-name">{item.name}</span>
                          <span className="tm-desc">{item.desc}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            );
          })()}
        </div>
        {sessionPanelOpen && onCloseSessionPanel && onResumeSession && onForkSession && (
          <SessionPanel
            projectPath={projectPath}
            isOpen={sessionPanelOpen}
            onClose={onCloseSessionPanel}
            onResumeSession={onResumeSession}
            onForkSession={onForkSession}
          />
        )}
        {sidebarOpen && (
          <RightSidebar
            messages={deferredMessages}
            agentTasks={agentTasks}
            onScrollToMessage={() => {/* TODO: Phase 4 - scrollToLine */}}
            scrollContainerRef={nullScrollRef}
            teamState={ctrl.teamState}
          />
        )}
      </div>
      {/* Bottom bar */}
      <div className="tv-bottom">
        {backgrounded && <span className="bottom-bg-badge">BG</span>}
        {queueLength > 0 && <span className="bottom-queue-badge">{queueLength} queued</span>}
        <button
          className="bottom-pill tv-bottom-model"
          title="Click to cycle model (F4)"
          onClick={() => onConfigChange?.({ modelIdx: (modelIdx + 1) % models.length })}
        >{models[modelIdx]?.display || "?"}</button>
        <span className="tv-bottom-sep">|</span>
        <button
          className={`bottom-pill tv-bottom-effort tv-bottom-effort--${efforts[effortIdx] || "high"}`}
          title="Click to cycle effort (F2)"
          onClick={() => onConfigChange?.({ effortIdx: (effortIdx + 1) % efforts.length })}
        >{efforts[effortIdx] || "high"}</button>
        <span className="tv-bottom-sep">|</span>
        <button
          className={`bottom-pill tv-bottom-perm tv-bottom-perm--${PERM_MODES[permModeIdx]?.sdk || "plan"}`}
          title="Click to cycle permission mode (Tab)"
          onClick={() => onConfigChange?.({ permModeIdx: (permModeIdx + 1) % PERM_MODES.length })}
        >{PERM_MODES[permModeIdx]?.display || "plan"}</button>
        {ctrl.teamState?.active && (
          <>
            <span className="tv-bottom-sep">|</span>
            <span className="tv-bottom-team">team: {ctrl.teamState.members.length} agent{ctrl.teamState.members.length !== 1 ? "s" : ""}</span>
          </>
        )}
        {stats.cost > 0 && (
          <>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className="tv-bottom-cost">${stats.cost.toFixed(3)}</span>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className="tv-bottom-stat">{fmtTokens(stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheWriteTokens)} tok</span>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className="tv-bottom-stat">{stats.turns}t</span>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className="tv-bottom-stat">{(stats.durationMs / 1000).toFixed(0)}s</span>
          </>
        )}
        {stats.tokens > 0 && stats.contextWindow > 0 && (() => {
          const pct = Math.min(Math.round((stats.tokens / stats.contextWindow) * 100), 100);
          const level = pct > 80 ? "high" : pct > 50 ? "mid" : "low";
          return (
            <>
              <span className="tv-bottom-sep">{"\u00b7"}</span>
              <span className="tv-ctx" title={`Context: ${(stats.tokens / 1000).toFixed(0)}k / ${(stats.contextWindow / 1000).toFixed(0)}k`}>
                <span className="tv-ctx-label">ctx</span>
                <span className="tv-ctx-bar">
                  <span className={`tv-ctx-fill tv-ctx-fill--${level}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="tv-ctx-pct">{pct}%</span>
              </span>
            </>
          );
        })()}
        {stats.rateLimitUtil > 0 && (
          <>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className={`tv-bottom-stat${stats.rateLimitUtil > 0.8 ? " tv-bottom-warn" : ""}`} title={`Rate limit: ${Math.round(stats.rateLimitUtil * 100)}%`}>
              quota {Math.round(stats.rateLimitUtil * 100)}%
            </span>
          </>
        )}
        {thinkingIdRef.current && (
          <span className="tv-bottom-thinking">
            <span className="tv-bottom-thinking-dot" />
            thinking
          </span>
        )}
        <span className="tv-bottom-spacer" />
        <button className="tv-bottom-btn" title="Attach files" onClick={handleAttachClick}><IconPlus /></button>
        <button
          className={`tv-bottom-btn tv-bottom-sidebar-toggle${sidebarOpen ? " active" : ""}`}
          title={sidebarOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          aria-label="Toggle right sidebar"
          onClick={toggleSidebar}
        >
          <IconSidebar />
        </button>
      </div>
    </div>
  );
});
