/**
 * Icons — single-file icon set for Figtree.
 * All icons use currentColor, size defaults to 16×16, and accept standard SVG props.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaults = (size: number, props: IconProps): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  fill: "none",
  "aria-hidden": true,
  ...props,
});

// ── Navigation / Tab bar ────────────────────────────────────────

/** Circular arrow — sessions history */
export function IconSessions({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <path d="M3 5a5.5 5.5 0 1 1 0 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="3,2 3,5 6,5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Bar chart — usage stats */
export function IconBarChart({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <rect x="2" y="9" width="3" height="5" rx="0.75" fill="currentColor" />
      <rect x="6.5" y="5" width="3" height="9" rx="0.75" fill="currentColor" />
      <rect x="11" y="2" width="3" height="12" rx="0.75" fill="currentColor" />
    </svg>
  );
}

/** Circle-i — about / info */
export function IconInfo({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="7" x2="8" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

// ── Window controls ─────────────────────────────────────────────

/** Minimize — horizontal line */
export function IconMinimize({ size = 10, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 10 1" width={size} height={Math.ceil(size / 10)} {...p} aria-hidden>
      <rect width="10" height="1" fill="currentColor" />
    </svg>
  );
}

/** Maximize — square outline */
export function IconMaximize({ size = 10, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} {...p} aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Close — X cross */
export function IconClose({ size = 10, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} {...p} aria-hidden>
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ── Right sidebar tabs ──────────────────────────────────────────

/** Bookmark ribbon */
export function IconBookmark({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <path d="M4 2h8a1 1 0 0 1 1 1v11.5l-5-3-5 3V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Rectangle with viewport — minimap */
export function IconMinimap({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="4" width="5" height="4" rx="0.75" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Checklist — todos */
export function IconTodos({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <rect x="1.5" y="2" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="4" x2="14.5" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="1.5" y="10" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="12" x2="14.5" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Thought bubble — thinking */
export function IconThinking({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <circle cx="8" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6.5c0-1.2 2-2 2-.5s-2 1.2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Connected nodes — agents */
export function IconAgents({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <circle cx="8" cy="3.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="3.5" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.5" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="6" x2="3.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="6" x2="12.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ── Session panel ───────────────────────────────────────────────

/** Fork — branch split */
export function IconFork({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} {...p} aria-hidden fill="none">
      <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="5" x2="9" y2="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ── Terminal view bottom bar ────────────────────────────────────

/** Plus — attach files */
export function IconPlus({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Sidebar panel toggle */
export function IconSidebar({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ── InfoStrip ───────────────────────────────────────────────────

/** Terminal / quick launch — chevron double-right */
export function IconTerminal({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <polyline points="2,3 8,8 2,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="8,3 14,8 8,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pencil — edit / system prompts */
export function IconPencil({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <path d="M11.5 2.5l2 2L5 13H3v-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="9.5" y1="4.5" x2="11.5" y2="6.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Gear — settings */
export function IconGear({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...defaults(size, p)}>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
