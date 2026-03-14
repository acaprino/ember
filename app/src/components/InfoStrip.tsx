import { memo } from "react";
import "./InfoStrip.css";

interface InfoStripProps {
  filter: string;
  projectCount: number;
  onOpenSettings: () => void;
  onOpenSystemPrompts: () => void;
}

export default memo(function InfoStrip({ filter, projectCount, onOpenSettings, onOpenSystemPrompts }: InfoStripProps) {
  return (
    <div className="info-strip">
      <div className="info-strip__left">
        {filter ? (
          <span className="info-strip__filter">Filter: {filter}</span>
        ) : (
          <span className="info-strip__count">{projectCount} project{projectCount !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="info-strip__right">
        <button
          className="info-strip__btn"
          onClick={onOpenSystemPrompts}
          title="System Prompts (Ctrl+Shift+P)"
          aria-label="Open system prompts"
        >
          &#9998;
        </button>
        <button
          className="info-strip__btn info-strip__gear"
          onClick={onOpenSettings}
          title="Settings (Ctrl+,)"
          aria-label="Open settings"
        >
          &#9881;
        </button>
      </div>
    </div>
  );
});
