import { memo, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

const appWindow = getCurrentWindow();

export default memo(function TitleBar() {
  const handleMinimize = useCallback(() => {
    appWindow.minimize();
  }, []);

  const handleMaximize = useCallback(() => {
    appWindow.toggleMaximize();
  }, []);

  const handleClose = useCallback(() => {
    appWindow.close();
  }, []);

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar__spacer" data-tauri-drag-region />
      <div className="window-controls">
        <button className="win-btn minimize" onClick={handleMinimize} aria-label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="win-btn maximize" onClick={handleMaximize} aria-label="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="win-btn close" onClick={handleClose} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
});
