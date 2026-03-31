import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "./types";

/** Strip characters unsafe for CSS font-family interpolation */
export function sanitizeFontName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\s\-_.]/g, "");
}

/** Validate a CSS color value — allows hex, rgb/hsl, color-mix, var() */
export function sanitizeColor(value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^(rgb|hsl)a?\([^;{}()]*\)$/.test(value)) return value;
  if (/^color-mix\([^;{}]*\)$/.test(value) && !/url\s*\(/i.test(value)) return value;
  if (/^var\(--[a-zA-Z0-9-]+\)$/.test(value)) return value;
  return "#000000";
}

/** Validate a CSS dimension value — allows px, rem, em, %, vh, vw, 0 */
function sanitizeDimension(value: string, fallback: string): string {
  if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|pt)$/.test(value)) return value;
  if (value === "0") return value;
  return fallback;
}

/** Validate a CSS box-shadow value — blocks url(), expression(), etc. */
function sanitizeShadow(value: string, fallback: string): string {
  if (/url\s*\(|expression\s*\(/i.test(value)) return fallback;
  if (/[;{}]/.test(value)) return fallback;
  return value;
}

/** Incremented on every theme application — consumers can compare to detect changes */
export let themeVersion = 0;

export function applyTheme(themes: Theme[], themeIdx: number): void {
  const theme = themes[themeIdx] ?? themes[0];
  if (!theme) return; // themes not loaded yet
  const c = theme.colors;
  const root = document.documentElement;

  // Colors (validated to prevent CSS injection from malicious theme files)
  root.style.setProperty("--bg", sanitizeColor(c.bg));
  root.style.setProperty("--surface", sanitizeColor(c.surface));
  root.style.setProperty("--mantle", sanitizeColor(c.mantle));
  root.style.setProperty("--crust", sanitizeColor(c.crust));
  root.style.setProperty("--text", sanitizeColor(c.text));
  root.style.setProperty("--text-dim", sanitizeColor(c.textDim));
  root.style.setProperty("--overlay0", sanitizeColor(c.overlay0));
  root.style.setProperty("--overlay1", sanitizeColor(c.overlay1));
  root.style.setProperty("--accent", sanitizeColor(c.accent));
  root.style.setProperty("--red", sanitizeColor(c.red));
  root.style.setProperty("--green", sanitizeColor(c.green));
  root.style.setProperty("--yellow", sanitizeColor(c.yellow));

  // User message styling (theme-configurable)
  root.style.setProperty("--user-msg-bg", sanitizeColor(c.userMsgBg ?? "color-mix(in srgb, var(--surface) 30%, transparent)"));
  root.style.setProperty("--user-msg-border", sanitizeColor(c.userMsgBorder ?? "color-mix(in srgb, var(--accent) 50%, transparent)"));

  // Terminal font
  if (theme.termFont) {
    root.style.setProperty("--font-mono", `"${sanitizeFontName(theme.termFont)}", "Consolas", monospace`);
  } else {
    root.style.removeProperty("--font-mono");
  }

  // Typographic scale — derived from termFontSize (default 14)
  const base = theme.termFontSize || 14;
  root.style.setProperty("--text-2xs", `${base - 3}px`);
  root.style.setProperty("--text-xs", `${base - 2}px`);
  root.style.setProperty("--text-sm", `${base - 1}px`);
  root.style.setProperty("--text-base", `${base}px`);
  root.style.setProperty("--text-md", `${base + 2}px`);
  root.style.setProperty("--text-lg", `${base + 3}px`);
  root.style.setProperty("--text-xl", `${base + 5}px`);

  // UI / chat font
  if (theme.uiFont) {
    root.style.setProperty("--chat-font-family", `"${sanitizeFontName(theme.uiFont)}", "Segoe UI", system-ui, sans-serif`);
  } else {
    root.style.removeProperty("--chat-font-family");
  }
  if (theme.uiFontSize) {
    root.style.setProperty("--chat-font-size", `${theme.uiFontSize}px`);
  } else {
    root.style.removeProperty("--chat-font-size");
  }

  // Detect light vs dark from bg luminance
  const isLight = isLightColor(c.bg);
  root.style.colorScheme = isLight ? "light" : "dark";

  root.classList.toggle("light-theme", isLight);

  const isRetro = !!theme.retro;
  root.classList.toggle("retro", isRetro);
  invoke("set_window_corner_preference", { retro: isRetro }).catch((err) => console.debug("[themes] set_window_corner_preference failed:", err));

  // Layout tokens — all optional, fall back to CSS :root defaults when absent
  const layout = theme.layout;
  const setOrRemove = (prop: string, val: string | undefined, sanitize: (v: string, f: string) => string, fallback: string) => {
    if (val) root.style.setProperty(prop, sanitize(val, fallback));
    else root.style.removeProperty(prop);
  };
  setOrRemove("--radius-sm", layout?.radiusSm, sanitizeDimension, "4px");
  setOrRemove("--radius-md", layout?.radiusMd, sanitizeDimension, "6px");
  setOrRemove("--radius-lg", layout?.radiusLg, sanitizeDimension, "6px");
  setOrRemove("--tab-height", layout?.tabHeight, sanitizeDimension, "42px");
  setOrRemove("--info-strip-height", layout?.infoStripHeight, sanitizeDimension, "32px");
  setOrRemove("--title-bar-height", layout?.titleBarHeight, sanitizeDimension, "32px");
  setOrRemove("--sidebar-width", layout?.sidebarWidth, sanitizeDimension, "200px");
  setOrRemove("--padding-container", layout?.padding, sanitizeDimension, "16px");

  // Spacing scale derived from spacingUnit (default 4px)
  if (layout?.spacingUnit) {
    const u = Math.max(1, Math.min(16, layout.spacingUnit));
    root.style.setProperty("--space-0", `${Math.round(u * 0.5)}px`);
    root.style.setProperty("--space-1", `${u}px`);
    root.style.setProperty("--space-2", `${u * 2}px`);
    root.style.setProperty("--space-3", `${u * 3}px`);
    root.style.setProperty("--space-4", `${u * 4}px`);
    root.style.setProperty("--space-6", `${u * 6}px`);
    root.style.setProperty("--space-8", `${u * 8}px`);
    root.style.setProperty("--space-12", `${u * 12}px`);
  } else {
    // Reset to defaults
    for (const k of ["--space-0", "--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8", "--space-12"]) {
      root.style.removeProperty(k);
    }
  }

  // Hover overlay opacity
  if (layout?.hoverOpacity !== undefined) {
    const opacity = Math.max(0, Math.min(100, layout.hoverOpacity));
    root.style.setProperty("--hover-overlay", `color-mix(in srgb, var(--text) ${opacity}%, transparent)`);
    root.style.setProperty("--hover-overlay-subtle", `color-mix(in srgb, var(--text) ${Math.round(opacity / 2)}%, transparent)`);
  } else {
    root.style.removeProperty("--hover-overlay");
    root.style.removeProperty("--hover-overlay-subtle");
  }

  // Modal shadow
  if (layout?.shadowModal) {
    root.style.setProperty("--shadow-modal", sanitizeShadow(layout.shadowModal, "0 8px 32px color-mix(in srgb, var(--crust) 80%, transparent)"));
  } else {
    root.style.removeProperty("--shadow-modal");
  }

  // Floating window style
  const isFloating = !!layout?.floating;
  root.classList.toggle("floating", isFloating);
  if (isFloating && layout?.floatingRadius) {
    root.style.setProperty("--floating-radius", sanitizeDimension(layout.floatingRadius, "10px"));
  } else {
    root.style.removeProperty("--floating-radius");
  }

  themeVersion++;
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
