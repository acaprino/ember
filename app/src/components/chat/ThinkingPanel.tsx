import { memo, useState } from "react";
import type { ChatMessage } from "../../types";

interface Props {
  messages: ChatMessage[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export default memo(function ThinkingPanel({ messages }: Props) {
  const thinkingMessages = messages.filter((m) => m.role === "thinking");

  if (thinkingMessages.length === 0) {
    return <div className="sidebar-empty">No thinking blocks yet</div>;
  }

  return (
    <div className="thinking-history-panel">
      {thinkingMessages.map((msg) => (
        <ThinkingEntry key={msg.id} msg={msg} />
      ))}
    </div>
  );
});

const ThinkingEntry = memo(function ThinkingEntry({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  if (msg.role !== "thinking") return null;

  const lineCount = msg.text.split("\n").length;
  const preview = msg.text.slice(0, 80).replace(/\n/g, " ");

  return (
    <div className="thinking-entry">
      <button className="thinking-entry-header" onClick={() => setExpanded(!expanded)}>
        <span className="thinking-entry-time">{formatTime(msg.timestamp)}</span>
        <span className="thinking-entry-preview">
          {expanded ? `${lineCount} lines` : (preview.length < msg.text.length ? preview + "..." : preview)}
        </span>
        <span className="thinking-entry-toggle">{expanded ? "\u25BE" : "\u25B8"}</span>
      </button>
      {expanded && (
        <pre className="thinking-entry-body">{msg.text}</pre>
      )}
    </div>
  );
});
