import { memo } from "react";
import type { ChatMessage } from "../../types";

interface Props {
  messages: ChatMessage[];
  onScrollToMessage: (msgId: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export default memo(function BookmarkPanel({ messages, onScrollToMessage }: Props) {
  const userMessages = messages.filter((m) => m.role === "user");

  if (userMessages.length === 0) {
    return <div className="sidebar-empty">No messages yet</div>;
  }

  return (
    <div className="bookmark-panel">
      {userMessages.map((msg) => (
        <button
          key={msg.id}
          className="bookmark-item"
          onClick={() => onScrollToMessage(msg.id)}
          title={msg.role === "user" ? msg.text : ""}
        >
          <span className="bookmark-arrow">{"\u25B8"}</span>
          <span className="bookmark-text">
            {msg.role === "user" ? (msg.text.length > 35 ? msg.text.slice(0, 32) + "..." : msg.text) : ""}
          </span>
          <span className="bookmark-time">{formatTime(msg.timestamp)}</span>
        </button>
      ))}
    </div>
  );
});
