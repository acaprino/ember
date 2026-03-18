import { invoke } from "@tauri-apps/api/core";
import { THEMES } from "./types";

export function applyTheme(themeIdx: number): void {
  const theme = THEMES[themeIdx] ?? THEMES[0];
  const c = theme.colors;
  const root = document.documentElement;

  root.style.setProperty("--bg", c.bg);
  root.style.setProperty("--surface", c.surface);
  root.style.setProperty("--mantle", c.mantle);
  root.style.setProperty("--crust", c.crust);
  root.style.setProperty("--text", c.text);
  root.style.setProperty("--text-dim", c.textDim);
  root.style.setProperty("--overlay0", c.overlay0);
  root.style.setProperty("--overlay1", c.overlay1);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--red", c.red);
  root.style.setProperty("--green", c.green);
  root.style.setProperty("--yellow", c.yellow);

  // Terminal font
  if (theme.termFont) {
    root.style.setProperty("--font-mono", `"${theme.termFont}", "Consolas", monospace`);
  } else {
    root.style.removeProperty("--font-mono");
  }
  if (theme.termFontSize) {
    root.style.setProperty("--text-base", `${theme.termFontSize}px`);
  } else {
    root.style.removeProperty("--text-base");
  }

  // UI / chat font
  if (theme.uiFont) {
    root.style.setProperty("--chat-font-family", `"${theme.uiFont}", "Segoe UI", system-ui, sans-serif`);
  } else {
    root.style.removeProperty("--chat-font-family");
  }
  if (theme.uiFontSize) {
    root.style.setProperty("--chat-font-size", `${theme.uiFontSize}px`);
  } else {
    root.style.removeProperty("--chat-font-size");
  }

  const isRetro = !!theme.retro;
  root.classList.toggle("retro", isRetro);
  invoke("set_window_corner_preference", { retro: isRetro }).catch(() => {});
}
