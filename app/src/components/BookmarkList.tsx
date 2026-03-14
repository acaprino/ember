import { memo, useRef, useEffect, useState, useCallback } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import "./BookmarkList.css";

interface BookmarkListProps {
  xterm: XTerm | null;
  isActive: boolean;
  bookmarksRef: React.RefObject<Map<number, string>>;
}

export default memo(function BookmarkList({ xterm, isActive, bookmarksRef }: BookmarkListProps) {
  const [entries, setEntries] = useState<{ line: number; text: string }[]>([]);
  const [activeLine, setActiveLine] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevKeysRef = useRef("");
  const activeLineRef = useRef(-1);
  const rafRef = useRef(0);

  // Sync entries from bookmarksRef — detect changes by serializing keys
  const syncEntries = useCallback(() => {
    const bm = bookmarksRef.current;
    const keys = [...bm.keys()].join(",");
    if (keys === prevKeysRef.current) return;
    prevKeysRef.current = keys;
    const arr: { line: number; text: string }[] = [];
    for (const [line, text] of bm) {
      arr.push({ line, text });
    }
    arr.sort((a, b) => a.line - b.line);
    setEntries(arr);
  }, [bookmarksRef]);

  // Find the nearest bookmark to the current viewport for highlighting
  const updateActive = useCallback(() => {
    if (!xterm) return;
    const vpTop = xterm.buffer.active.viewportY;
    const vpBottom = vpTop + xterm.rows;
    const bm = bookmarksRef.current;
    let nearest = -1;
    let nearestDist = Infinity;
    for (const line of bm.keys()) {
      if (line <= vpBottom) {
        const d = Math.abs(line - vpTop);
        if (d < nearestDist || (d === nearestDist && line > nearest)) {
          nearest = line;
          nearestDist = d;
        }
      }
    }
    if (nearest !== activeLineRef.current) {
      activeLineRef.current = nearest;
      setActiveLine(nearest);
    }
  }, [xterm, bookmarksRef]);

  // Throttle sync+active updates to once per animation frame — these fire on
  // every PTY chunk (hundreds/sec during heavy output) but the viewport can
  // only change once per frame.
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      syncEntries();
      updateActive();
    });
  }, [syncEntries, updateActive]);

  useEffect(() => {
    if (!xterm) return;
    syncEntries();
    updateActive();
    const d1 = xterm.onWriteParsed(() => scheduleUpdate());
    const d2 = xterm.onScroll(() => scheduleUpdate());
    return () => {
      d1.dispose();
      d2.dispose();
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    };
  }, [xterm, syncEntries, updateActive, scheduleUpdate]);

  // Also sync on tab activation
  useEffect(() => {
    if (isActive) { syncEntries(); updateActive(); }
  }, [isActive, syncEntries, updateActive]);

  // Auto-scroll the bookmark list to keep the active item visible
  useEffect(() => {
    if (activeLine < 0 || !containerRef.current) return;
    const active = containerRef.current.querySelector(".bookmark-item--active");
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeLine]);

  const scrollTo = useCallback(
    (line: number) => {
      if (!xterm) return;
      const maxScroll = xterm.buffer.active.length - xterm.rows;
      const target = Math.max(0, Math.min(line - 2, maxScroll));
      xterm.scrollToLine(target);
      xterm.focus();
    },
    [xterm],
  );

  if (!xterm || entries.length === 0) return null;

  return (
    <div ref={containerRef} className="bookmark-list">
      <div className="bookmark-list-header">Prompts</div>
      <div className="bookmark-list-items">
        {entries.map((e, i) => (
          <button
            key={e.line}
            className={`bookmark-item${e.line === activeLine ? " bookmark-item--active" : ""}`}
            onClick={() => scrollTo(e.line)}
            title={e.text}
          >
            <span className="bookmark-index">{i + 1}</span>
            <span className="bookmark-text">{e.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
