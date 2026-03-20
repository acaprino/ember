import { useCallback, useEffect, useRef } from "react";

const AT_BOTTOM_THRESHOLD = 60;

export interface StickyScrollHandle {
  stickyRef: React.RefObject<boolean>;
  scrollToBottom: () => void;
}

/**
 * Manages sticky auto-scroll behavior for a scrollable container.
 * Uses a counter-based programmatic scroll guard that survives multiple
 * scroll events from a single scrollTop assignment.
 */
export function useStickyScroll(scrollRef: React.RefObject<HTMLDivElement | null>): StickyScrollHandle {
  const stickyRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollGenRef = useRef(0);
  const lastSeenScrollGenRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollGenRef.current++;
    el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (programmaticScrollGenRef.current !== lastSeenScrollGenRef.current) {
        lastSeenScrollGenRef.current = programmaticScrollGenRef.current;
        lastScrollTopRef.current = el.scrollTop;
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;
      if (scrollTop < lastScrollTopRef.current && !atBottom) {
        stickyRef.current = false;
      } else if (atBottom) {
        stickyRef.current = true;
      }
      lastScrollTopRef.current = scrollTop;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  return { stickyRef, scrollToBottom };
}
