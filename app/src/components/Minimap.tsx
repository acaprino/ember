import { memo, useRef, useEffect, useCallback } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import "./Minimap.css";

const CHAR_W = 2;
const CHAR_H = 3;
const MINIMAP_WIDTH = 90;
const BOOKMARK_W = 6;
const MAX_CANVAS_PX = 16384; // Max hardware pixels — safe for all GPUs
const SPECIAL_CHARS = new Set("{}[]()=><|&;:");
const WHEEL_LINE_PX = 25;
const RENDER_THROTTLE_MS = 150; // Throttle full re-renders during rapid output

interface ThemeColors {
  bg: string;
  text: string;
  dim: string;
  accent: string;
  yellow: string;
}

interface MinimapProps {
  xterm: XTerm | null;
  isActive: boolean;
  bookmarksRef: React.RefObject<Map<number, string>>;
}

export default memo(function Minimap({ xterm, isActive, bookmarksRef }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRafRef = useRef(0);
  const vpRafRef = useRef(0);
  const throttleTimerRef = useRef(0);
  const lastRenderTimeRef = useRef(0);
  const isDraggingRef = useRef(false);
  const colorsRef = useRef<ThemeColors | null>(null);
  const prevCanvasDimsRef = useRef({ w: 0, h: 0, dpr: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const scheduleRenderRef = useRef<(() => void) | null>(null);

  // Read theme colors from CSS variables
  const readColors = useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    colorsRef.current = {
      bg: style.getPropertyValue("--bg").trim(),
      text: style.getPropertyValue("--text").trim(),
      dim: style.getPropertyValue("--text-dim").trim(),
      accent: style.getPropertyValue("--accent").trim(),
      yellow: style.getPropertyValue("--yellow").trim(),
    };
  }, []);

  // Detect theme changes via MutationObserver on document.documentElement style attribute
  useEffect(() => {
    readColors();
    const observer = new MutationObserver(() => {
      colorsRef.current = null; // Invalidate — will be re-read on next render
      scheduleRenderRef.current?.();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [readColors]);

  // Lightweight viewport-only update — no canvas redraw, just repositions the indicator.
  // Called on scroll events where buffer content hasn't changed.
  const updateViewport = useCallback(() => {
    if (!xterm || !viewportRef.current || !containerRef.current) return;
    const buf = xterm.buffer.active;
    const totalLines = buf.length;
    const rawH = totalLines * CHAR_H;
    const dpr = window.devicePixelRatio || 1;
    const maxCssH = Math.floor(MAX_CANVAS_PX / dpr);
    const canvasH = Math.min(rawH, maxCssH);
    const scale = canvasH / rawH;

    const vpTop = buf.viewportY * CHAR_H * scale;
    const vpHeight = xterm.rows * CHAR_H * scale;
    viewportRef.current.style.top = `${vpTop}px`;
    viewportRef.current.style.height = `${vpHeight}px`;

    // Auto-scroll minimap container to keep viewport indicator visible
    if (!isDraggingRef.current) {
      const containerH = containerRef.current.clientHeight;
      const scrollTop = containerRef.current.scrollTop;
      if (vpTop < scrollTop || vpTop + vpHeight > scrollTop + containerH) {
        containerRef.current.scrollTop = vpTop - containerH / 2 + vpHeight / 2;
      }
    }
  }, [xterm]);

  // Full canvas content render — iterates buffer lines
  const render = useCallback(() => {
    if (!xterm || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!colorsRef.current) readColors();
    const { bg: bgColor, text: textColor, dim: dimColor, accent: accentColor, yellow: yellowColor } = colorsRef.current!;

    const buf = xterm.buffer.active;
    const totalLines = buf.length;
    const rawH = totalLines * CHAR_H;
    const dpr = window.devicePixelRatio || 1;
    // Cap canvas CSS height so hardware pixels never exceed GPU limits
    const maxCssH = Math.floor(MAX_CANVAS_PX / dpr);
    const canvasH = Math.min(rawH, maxCssH);
    const lineStep = rawH > canvasH ? Math.ceil(totalLines / (canvasH / CHAR_H)) : 1;
    const scale = canvasH / rawH;

    const needW = Math.round(MINIMAP_WIDTH * dpr);
    const needH = Math.round(canvasH * dpr);
    const prev = prevCanvasDimsRef.current;
    if (prev.w !== needW || prev.h !== needH || prev.dpr !== dpr) {
      canvas.width = needW;
      canvas.height = needH;
      canvas.style.width = `${MINIMAP_WIDTH}px`;
      canvas.style.height = `${canvasH}px`;
      prev.w = needW;
      prev.h = needH;
      prev.dpr = dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, MINIMAP_WIDTH, canvasH);

    const bookmarkSet = bookmarksRef.current; // Map<number, string>
    const maxChars = Math.floor(MINIMAP_WIDTH / CHAR_W);

    for (let i = 0; i < totalLines; i += lineStep) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(false);
      const y = Math.floor(i * CHAR_H * scale);
      const isBookmarked = bookmarkSet.has(i);

      if (isBookmarked) {
        ctx.fillStyle = yellowColor;
        ctx.globalAlpha = 0.95;
        ctx.fillRect(0, y, BOOKMARK_W, CHAR_H);
        ctx.globalAlpha = 1.0;
      }

      const startChar = isBookmarked ? Math.ceil((BOOKMARK_W + 1) / CHAR_W) : 0;
      for (let j = startChar; j < Math.min(text.length, maxChars); j++) {
        const ch = text[j];
        if (ch === " " || ch === undefined) continue;
        const isSpecial = SPECIAL_CHARS.has(ch);
        ctx.fillStyle = isSpecial ? accentColor : (j < 4 && text.trimStart().length < text.length ? dimColor : textColor);
        ctx.globalAlpha = isSpecial ? 0.6 : 0.45;
        ctx.fillRect(j * CHAR_W, y, CHAR_W, CHAR_H - 1);
      }
    }
    ctx.globalAlpha = 1.0;

    // Also update viewport position after content render
    updateViewport();
  }, [xterm, readColors, updateViewport, bookmarksRef]);

  const scheduleRender = useCallback(() => {
    // Already have a trailing timer — it will handle the final render
    if (throttleTimerRef.current) return;

    const now = performance.now();
    const elapsed = now - lastRenderTimeRef.current;

    if (elapsed >= RENDER_THROTTLE_MS) {
      // Enough time passed — render on next frame
      if (!contentRafRef.current) {
        contentRafRef.current = requestAnimationFrame(() => {
          contentRafRef.current = 0;
          lastRenderTimeRef.current = performance.now();
          render();
        });
      }
    }

    // Always schedule a trailing render to capture final state
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = 0;
      if (!contentRafRef.current) {
        contentRafRef.current = requestAnimationFrame(() => {
          contentRafRef.current = 0;
          lastRenderTimeRef.current = performance.now();
          render();
        });
      }
    }, RENDER_THROTTLE_MS);
  }, [render]);

  const scheduleViewportUpdate = useCallback(() => {
    if (vpRafRef.current) return;
    vpRafRef.current = requestAnimationFrame(() => {
      vpRafRef.current = 0;
      updateViewport();
    });
  }, [updateViewport]);

  useEffect(() => {
    if (!xterm) return;
    scheduleRender();

    const disposables = [
      xterm.onWriteParsed(() => scheduleRender()),
      xterm.onScroll(() => scheduleViewportUpdate()),
      xterm.onResize(() => scheduleRender()),
    ];

    return () => {
      disposables.forEach((d) => d.dispose());
      if (contentRafRef.current) { cancelAnimationFrame(contentRafRef.current); contentRafRef.current = 0; }
      if (vpRafRef.current) { cancelAnimationFrame(vpRafRef.current); vpRafRef.current = 0; }
      if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = 0; }
      if (canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
      prevCanvasDimsRef.current = { w: 0, h: 0, dpr: 0 };
    };
  }, [xterm, scheduleRender, scheduleViewportUpdate]);

  // Keep scheduleRenderRef in sync for the MutationObserver callback
  useEffect(() => { scheduleRenderRef.current = scheduleRender; }, [scheduleRender]);

  useEffect(() => { if (isActive) scheduleRender(); }, [isActive, scheduleRender]);

  // Forward wheel events to terminal instead of scrolling minimap container
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !xterm) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      let lines: number;
      if (e.deltaMode === 1) lines = Math.round(e.deltaY);
      else if (e.deltaMode === 2) lines = Math.round(e.deltaY * xterm.rows);
      else lines = Math.round(e.deltaY / WHEEL_LINE_PX) || (e.deltaY > 0 ? 1 : -1);
      xterm.scrollLines(lines);
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [xterm]);

  // Clean up drag listeners on unmount
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  // Click to scroll — snaps to nearby bookmarks on click only
  const scrollToY = useCallback(
    (clientY: number, snap: boolean) => {
      if (!xterm || !containerRef.current || !canvasRef.current) return;
      const totalLines = xterm.buffer.active.length;
      if (totalLines === 0) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const y = clientY - rect.top + containerRef.current.scrollTop;
      const rawH = totalLines * CHAR_H;
      const dpr = window.devicePixelRatio || 1;
      const maxCssH = Math.floor(MAX_CANVAS_PX / dpr);
      const canvasH = Math.min(rawH, maxCssH);
      const scale = canvasH / rawH;
      const line = Math.floor(y / (CHAR_H * scale));

      let targetCenter = line;
      if (snap) {
        let nearest: number | undefined;
        let nearestDist = 4;
        for (const b of bookmarksRef.current.keys()) {
          const d = Math.abs(b - line);
          if (d < nearestDist) { nearest = b; nearestDist = d; }
        }
        if (nearest !== undefined) targetCenter = nearest;
      }

      const maxScroll = xterm.buffer.active.length - xterm.rows;
      const targetLine = Math.max(0, Math.min(targetCenter - Math.floor(xterm.rows / 2), maxScroll));
      xterm.scrollToLine(targetLine);
    },
    [xterm, bookmarksRef],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      document.body.style.cursor = "grabbing";
      scrollToY(e.clientY, true); // snap on initial click

      const handleMouseMove = (ev: MouseEvent) => {
        ev.preventDefault();
        scrollToY(ev.clientY, false); // no snap during drag
      };
      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        dragCleanupRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      dragCleanupRef.current = handleMouseUp;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [scrollToY],
  );

  if (!xterm) return null;

  return (
    <div ref={containerRef} className="minimap" onMouseDown={handleMouseDown}>
      <div className="minimap-canvas-wrapper">
        <canvas ref={canvasRef} />
        <div ref={viewportRef} className="minimap-viewport" />
      </div>
    </div>
  );
});
