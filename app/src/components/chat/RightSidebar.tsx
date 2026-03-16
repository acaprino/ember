import { memo, useState } from "react";
import type { ChatMessage } from "../../types";
import BookmarkPanel from "./BookmarkPanel";
import MinimapPanel from "./MinimapPanel";
import ThinkingPanel from "./ThinkingPanel";
import "./RightSidebar.css";

type SidebarTab = "bookmarks" | "minimap" | "thinking";

interface Props {
  messages: ChatMessage[];
  onScrollToMessage: (msgId: string) => void;
}

export default memo(function RightSidebar({ messages, onScrollToMessage }: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("bookmarks");

  const tabs: { id: SidebarTab; icon: string; title: string }[] = [
    { id: "bookmarks", icon: "\uD83D\uDCD1", title: "Bookmarks" },
    { id: "minimap", icon: "\uD83D\uDDFA", title: "Minimap" },
    { id: "thinking", icon: "\uD83E\uDDE0", title: "Thinking" },
  ];

  return (
    <div className="right-sidebar">
      <div className="right-sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`right-sidebar-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.title}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      <div className="right-sidebar-content">
        {activeTab === "bookmarks" && (
          <BookmarkPanel messages={messages} onScrollToMessage={onScrollToMessage} />
        )}
        {activeTab === "minimap" && (
          <MinimapPanel messages={messages} onScrollToMessage={onScrollToMessage} />
        )}
        {activeTab === "thinking" && (
          <ThinkingPanel messages={messages} />
        )}
      </div>
    </div>
  );
});
