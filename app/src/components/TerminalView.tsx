import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MODELS, EFFORTS } from "../types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fmtTokens } from "../utils/format";
import type { SessionViewProps } from "./SessionViewProps";
import ChatInput from "./chat/ChatInput";
import AskQuestionCard from "./chat/AskQuestionCard";
import RightSidebar from "./chat/RightSidebar";
import TermToolLine from "./terminal/TermToolLine";
import TermToolGroup from "./terminal/TermToolGroup";
import TermPermPrompt from "./terminal/TermPermPrompt";
import TermThinkingLine from "./terminal/TermThinkingLine";
import TermResultLine from "./terminal/TermResultLine";
import TermErrorLine from "./terminal/TermErrorLine";
import "./TerminalView.css";

/** Elapsed timer — ticks every second while visible */
const ElapsedTimer = memo(function ElapsedTimer({ startTime }: { startTime: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  return <span className="tv-elapsed">{elapsed}s</span>;
});

/** Activity spinner — shows pulsing dot + label when agent is working */
const ActivitySpinner = memo(function ActivitySpinner({ label }: { label: string }) {
  return (
    <div className="tv-activity">
      <span className="tv-activity-dot" />
      <span className="tv-activity-label">{label}</span>
      <ElapsedTimer startTime={Date.now()} />
    </div>
  );
});

export default memo(function TerminalView(props: SessionViewProps) {
  const {
    modelIdx, effortIdx, isActive,
    hideThinking,
    controller: ctrl,
  } = props;

  const {
    messages, displayItems, deferredMessages,
    inputState, stats, agentTasks, sdkCommands, sdkAgents,
    hasUnresolvedPermission,
    streamingTextRef, streamingIdRef, streamingTick,
    thinkingTextRef, thinkingIdRef, thinkingTick,
    messagesEndRef,
    handleSubmit, handlePermissionRespond, handleAskUserRespond,
    handleCommand, handleInterrupt,
    droppedFiles, setDroppedFiles, handleDroppedFilesConsumed, handleAttachClick,
  } = ctrl;

  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [messages, streamingTick, thinkingTick, messagesEndRef]);

  // Auto-focus textarea when window regains focus
  useEffect(() => {
    if (!isActive) return;
    const handleWindowFocus = () => {
      requestAnimationFrame(() => {
        const textarea = scrollRef.current?.closest(".terminal-view")?.querySelector("textarea");
        textarea?.focus();
      });
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [isActive]);

  // Keyboard shortcuts — Ctrl+C copies selection or interrupts agent
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "c") {
      if (window.getSelection()?.toString()) return;
      handleInterrupt();
    } else if (e.ctrlKey && e.key === "b") {
      e.preventDefault();
      setSidebarOpen(prev => !prev);
    }
  }, [handleInterrupt]);

  // Virtualizer
  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 20,
    getItemKey: (index) => displayItems[index].id,
  });

  // Drag & Drop
  useEffect(() => {
    if (!isActive) return;
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over" || event.payload.type === "enter") {
        setIsDragging(true);
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const paths = event.payload.paths.map(p => String(p));
        if (paths.length > 0) {
          setDroppedFiles(paths);
          messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
          getCurrentWindow().setFocus().then(() => {
            setTimeout(() => {
              const textarea = scrollRef.current?.closest(".terminal-view")?.querySelector("textarea");
              textarea?.focus();
            }, 100);
          }).catch(() => {});
        }
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [isActive, setDroppedFiles, messagesEndRef]);

  // Click anywhere -> refocus textarea
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable) return;
    if (target.closest("button, a, [role='button']")) return;
    const textarea = (e.currentTarget as HTMLElement).querySelector("textarea");
    textarea?.focus();
  }, []);

  return (
    <div
      className="terminal-view"
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      tabIndex={0}
    >
      <div className="tv-main-row">
      <div ref={scrollRef} className="tv-scroll" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !streamingIdRef.current && !thinkingIdRef.current && inputState === "idle" && (
          <div className="tv-line">
            <ActivitySpinner label="Initializing session..." />
          </div>
        )}
        {/* Virtualized message list */}
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = displayItems[virtualRow.index];
            const content = (() => {
              if (item.role === "tool-group") {
                return <TermToolGroup tools={item.tools} />;
              }
              const msg = item;
              switch (msg.role) {
                case "user":
                  return <div className="tv-user"><span className="tv-user-prompt">{"\u276F"}</span>{msg.text}</div>;
                case "assistant":
                  return <pre className="tv-assistant">{msg.text}</pre>;
                case "tool":
                  return <TermToolLine tool={msg.tool} input={msg.input} output={msg.output} success={msg.success} />;
                case "permission":
                  return <TermPermPrompt tool={msg.tool} description={msg.description} suggestions={msg.suggestions} resolved={msg.resolved} allowed={msg.allowed} onRespond={(allow, sugg) => handlePermissionRespond(msg.id, allow, sugg)} />;
                case "ask":
                  return <AskQuestionCard questions={msg.questions} resolved={msg.resolved} answers={msg.answers} onRespond={(answers) => handleAskUserRespond(msg.id, answers)} />;
                case "thinking":
                  if (hideThinking) {
                    if (msg.ended) return null;
                    return <div className="tv-activity"><span className="tv-activity-dot" /><span className="tv-activity-label">Thinking...</span></div>;
                  }
                  return <TermThinkingLine text={msg.text} ended={msg.ended} />;
                case "result":
                  return <TermResultLine cost={msg.cost} inputTokens={msg.inputTokens} outputTokens={msg.outputTokens} cacheReadTokens={msg.cacheReadTokens} turns={msg.turns} durationMs={msg.durationMs} />;
                case "error":
                  return <TermErrorLine code={msg.code} message={msg.message} />;
                case "status":
                  return <span className="tv-status">[{msg.model}] {msg.status}</span>;
                case "history-separator":
                  return <div className="tv-sep"><span className="tv-sep-rule" /><span>previous session</span><span className="tv-sep-rule" /></div>;
                default:
                  return null;
              }
            })();
            if (content === null) return (
              <div key={item.id} data-index={virtualRow.index} ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)`, height: 0, overflow: "hidden" }} />
            );
            return (
              <div
                key={item.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                id={`msg-${item.id}`}
                className={`tv-line${item.id.startsWith("hist-") ? " tv-line--history" : ""}`}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              >
                {content}
              </div>
            );
          })}
        </div>
        {/* Live thinking outside virtualizer */}
        {thinkingIdRef.current && !hideThinking && (
          <div className="tv-line">
            <TermThinkingLine text={thinkingTextRef.current} ended={false} />
          </div>
        )}
        {thinkingIdRef.current && hideThinking && (
          <div className="tv-line">
            <div className="tv-activity"><span className="tv-activity-dot" /><span className="tv-activity-label">Thinking...</span></div>
          </div>
        )}
        {/* Live streaming outside virtualizer */}
        {streamingIdRef.current && (
          <div className="tv-line">
            <pre className="tv-assistant tv-assistant--streaming">{streamingTextRef.current}</pre>
          </div>
        )}
        {/* Activity spinner when processing — replaces input field */}
        {inputState === "processing" && !streamingIdRef.current && !thinkingIdRef.current && !hasUnresolvedPermission && messages.length > 0 && (
          <div className="tv-line">
            <ActivitySpinner label="Working..." />
          </div>
        )}
        {/* Input — only when awaiting input */}
        {inputState === "awaiting_input" && (
          <ChatInput
            onSubmit={handleSubmit}
            onCommand={handleCommand}
            disabled={false}
            processing={false}
            isActive={isActive}
            inputStyle="terminal"
            sdkCommands={sdkCommands}
            sdkAgents={sdkAgents}
            droppedFiles={droppedFiles}
            onDroppedFilesConsumed={handleDroppedFilesConsumed}
          />
        )}
        <div ref={messagesEndRef} />
      </div>
      {sidebarOpen && (
        <RightSidebar messages={deferredMessages} agentTasks={agentTasks} onScrollToMessage={() => {}} scrollContainerRef={scrollRef} />
      )}
      </div>{/* end tv-main-row */}
      {/* Bottom bar */}
      <div className="tv-bottom">
        <span className="tv-bottom-model">{MODELS[modelIdx]?.display || "?"}</span>
        <span className="tv-bottom-sep">|</span>
        <span className={`tv-bottom-effort tv-bottom-effort--${EFFORTS[effortIdx] || "high"}`}>{EFFORTS[effortIdx] || "high"}</span>
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
        {stats.tokens > 0 && stats.contextWindow > 0 && (
          <>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className="tv-bottom-stat" title={`Context: ${(stats.tokens / 1000).toFixed(0)}k / ${(stats.contextWindow / 1000).toFixed(0)}k`}>
              ctx {Math.round((stats.tokens / stats.contextWindow) * 100)}%
            </span>
          </>
        )}
        {stats.rateLimitUtil > 0 && (
          <>
            <span className="tv-bottom-sep">{"\u00b7"}</span>
            <span className={`tv-bottom-stat${stats.rateLimitUtil > 0.8 ? " tv-bottom-warn" : ""}`} title={`Rate limit: ${Math.round(stats.rateLimitUtil * 100)}%`}>
              quota {Math.round(stats.rateLimitUtil * 100)}%
            </span>
          </>
        )}
        <span className="tv-bottom-spacer" />
        <button className="tv-bottom-attach" title="Attach files" onClick={handleAttachClick}>+</button>
        <button
          className={`tv-bottom-sidebar-toggle${sidebarOpen ? " active" : ""}`}
          title={sidebarOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          aria-label="Toggle right sidebar"
          onClick={() => setSidebarOpen(prev => !prev)}
        >
          &#9776;
        </button>
      </div>
      {isDragging && (
        <div className="chat-drop-overlay">
          <span className="chat-drop-overlay-text">Drop files here</span>
        </div>
      )}
    </div>
  );
});
