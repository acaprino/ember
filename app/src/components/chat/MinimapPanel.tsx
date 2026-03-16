import { memo } from "react";
import type { ChatMessage } from "../../types";

interface Props {
  messages: ChatMessage[];
  onScrollToMessage: (msgId: string) => void;
}

function roleColor(role: string): string {
  switch (role) {
    case "user": return "var(--accent)";
    case "assistant": return "var(--overlay0)";
    case "tool": return "var(--yellow)";
    case "permission": return "var(--yellow)";
    case "thinking": return "var(--overlay0)";
    case "result": return "var(--green)";
    case "error": return "var(--red)";
    default: return "var(--overlay0)";
  }
}

function blockHeight(msg: ChatMessage): number {
  if (msg.role === "user") return Math.min(4 + msg.text.length / 20, 16);
  if (msg.role === "assistant") return Math.min(4 + msg.text.length / 40, 24);
  if (msg.role === "tool") return 6;
  if (msg.role === "result") return 3;
  if (msg.role === "thinking") return Math.min(4 + msg.text.length / 40, 12);
  return 4;
}

export default memo(function MinimapPanel({ messages, onScrollToMessage }: Props) {
  if (messages.length === 0) {
    return <div className="sidebar-empty">No messages yet</div>;
  }

  return (
    <div className="minimap-panel">
      {messages.filter(m => m.role !== "status").map((msg) => (
        <div
          key={msg.id}
          className="minimap-block"
          style={{
            height: blockHeight(msg),
            background: roleColor(msg.role),
            opacity: msg.role === "thinking" ? 0.4 : 0.6,
          }}
          onClick={() => onScrollToMessage(msg.id)}
          title={msg.role}
        />
      ))}
    </div>
  );
});
