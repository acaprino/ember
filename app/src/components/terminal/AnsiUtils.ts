/**
 * AnsiUtils — ANSI escape sequence utilities for xterm.js rendering.
 * All colors use 24-bit truecolor (\x1b[38;2;r;g;bm).
 */

import type { TerminalPalette } from "./themes";

// ── Constants ──────────────────────────────────────────────────────
export const ESC = "\x1b";
export const CSI = `${ESC}[`;

// ── SGR (Select Graphic Rendition) ─────────────────────────────────
export const RESET = `${CSI}0m`;
export const BOLD = `${CSI}1m`;
export const DIM = `${CSI}2m`;
export const ITALIC = `${CSI}3m`;
export const UNDERLINE = `${CSI}4m`;
export const STRIKETHROUGH = `${CSI}9m`;
export const BOLD_OFF = `${CSI}22m`;
export const ITALIC_OFF = `${CSI}23m`;
export const UNDERLINE_OFF = `${CSI}24m`;

// ── OSC 8 Hyperlinks ──────────────────────────────────────────────
const OSC8_START = `${ESC}]8;;`;
const OSC8_END = "\x07";

/** Parse hex color (#RRGGBB or #RGB) to [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Set foreground color using 24-bit truecolor */
export function fg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${CSI}38;2;${r};${g};${b}m`;
}

/** Set background color using 24-bit truecolor */
export function bg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${CSI}48;2;${r};${g};${b}m`;
}

// ── Cursor movement ────────────────────────────────────────────────
export function cursorUp(n = 1): string { return `${CSI}${n}A`; }
export function cursorDown(n = 1): string { return `${CSI}${n}B`; }
export function cursorForward(n = 1): string { return `${CSI}${n}C`; }
export function cursorBack(n = 1): string { return `${CSI}${n}D`; }
export function cursorColumn(col: number): string { return `${CSI}${col}G`; }
export function cursorPosition(row: number, col: number): string { return `${CSI}${row};${col}H`; }
export const CURSOR_SAVE = `${ESC}7`;
export const CURSOR_RESTORE = `${ESC}8`;

// ── Erase ──────────────────────────────────────────────────────────
export const ERASE_LINE = `${CSI}2K`;
export const ERASE_TO_END = `${CSI}0K`;
export const ERASE_BELOW = `${CSI}0J`;
export const ERASE_SCREEN = `${CSI}2J`;

// ── Sanitization ──────────────────────────────────────────────────

/** Strip terminal control sequences from agent-sourced text (security) */
export function sanitizeAgentText(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")    // CSI sequences (including private mode)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")  // DCS, SOS, PM, APC
    .replace(/\x1b[78]/g, "")                    // cursor save/restore
    .replace(/[\x80-\x9f]/g, "")                 // C1 control codes
    .replace(/\x1b/g, "");                       // any remaining ESC
}

/** Sanitize pasted text: strip escape sequences (like sanitizeAgentText) + flatten newlines */
export function sanitizePastedText(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")         // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")        // DCS, SOS, PM, APC
    .replace(/\x1b[78]/g, "")                          // cursor save/restore
    .replace(/[\x80-\x9f]/g, "")                       // C1 control codes
    .replace(/\x1b/g, "")                              // remaining ESC
    .replace(/\r\n|\r|\n/g, " ")                       // flatten multiline
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");   // strip control chars
}

// ── Word wrapping ──────────────────────────────────────────────────

/** Strip ANSI escape sequences for length calculation */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b[78]/g, "");
}

/** Get visible length of a string (excludes ANSI sequences) */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Word-wrap text to fit within a given column width.
 * Returns an array of lines. Preserves existing newlines.
 * Does NOT add ANSI formatting — caller should wrap output.
 */
export function wordWrap(text: string, cols: number): string[] {
  if (cols <= 0) return [text];
  const result: string[] = [];
  const paragraphs = text.split("\n");

  for (const para of paragraphs) {
    if (para.length === 0) {
      result.push("");
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = "";
    let lineLen = 0;

    for (const word of words) {
      const wLen = word.length;
      if (lineLen + wLen > cols && lineLen > 0) {
        result.push(line);
        line = "";
        lineLen = 0;
        // Skip leading whitespace on new line
        if (/^\s+$/.test(word)) continue;
      }
      line += word;
      lineLen += wLen;
    }
    if (line.length > 0) result.push(line);
  }
  return result;
}

// ── Box drawing ────────────────────────────────────────────────────

const BOX = {
  topLeft: "\u256d",
  topRight: "\u256e",
  bottomLeft: "\u2570",
  bottomRight: "\u256f",
  horizontal: "\u2500",
  vertical: "\u2502",
} as const;

/**
 * Draw a box around content lines.
 * Returns an array of ANSI-formatted lines.
 *
 * @param title - Box title (shown in top border)
 * @param content - Array of content lines (will be padded to box width)
 * @param cols - Available terminal columns
 * @param borderColor - Hex color for the border
 * @param palette - Terminal palette for text colors
 */
export function boxDraw(
  title: string,
  content: string[],
  cols: number,
  borderColor: string,
  palette: TerminalPalette,
): string[] {
  const innerWidth = Math.max(cols - 4, 20); // 2 for border + 2 for padding
  const bc = fg(borderColor);
  const tc = fg(palette.text);
  const lines: string[] = [];

  // Top border: ╭─ Title ─────────╮
  const titleStr = title ? ` ${title} ` : "";
  const topFill = Math.max(0, innerWidth - stripAnsi(titleStr).length);
  lines.push(
    `${bc}${BOX.topLeft}${BOX.horizontal}${RESET}${tc}${titleStr}${RESET}${bc}${BOX.horizontal.repeat(topFill)}${BOX.topRight}${RESET}`
  );

  // Content lines: │ content │
  for (const line of content) {
    const visible = stripAnsi(line);
    const pad = Math.max(0, innerWidth - visible.length);
    lines.push(
      `${bc}${BOX.vertical}${RESET} ${line}${" ".repeat(pad)}${bc}${BOX.vertical}${RESET}`
    );
  }

  // Bottom border: ╰─────────────────╯
  lines.push(
    `${bc}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${RESET}`
  );

  return lines;
}

// ── Inline markdown formatting ─────────────────────────────────────

/**
 * Convert inline markdown (bold, italic, code) to ANSI sequences.
 * Only handles: **bold**, *italic*, `code`
 */
export function inlineMarkdown(text: string, palette: TerminalPalette): string {
  return text
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD_OFF}`)
    // Italic: *text*
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, `${ITALIC}$1${ITALIC_OFF}`)
    // Inline code: `code`
    .replace(/`([^`]+)`/g, `${fg(palette.accent)}$1${RESET}`)
    // URLs → OSC 8 hyperlinks (validated, clickable in xterm.js)
    .replace(/(https?:\/\/[^\s)>\]]+)/g, (_, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return url;
        return `${OSC8_START}${url}${OSC8_END}${fg(palette.accent)}${UNDERLINE}${url}${RESET}${OSC8_START}${OSC8_END}`;
      } catch { return url; }
    })
    // GitHub issue refs: owner/repo#123
    .replace(/\b([\w.-]+\/[\w.-]+)#(\d+)\b/g, (_, repo, num) => {
      const url = `https://github.com/${repo}/issues/${num}`;
      return `${OSC8_START}${url}${OSC8_END}${fg(palette.accent)}${repo}#${num}${RESET}${OSC8_START}${OSC8_END}`;
    });
}

// ── Code syntax highlighting ──────────────────────────────────────

const KEYWORDS = new Set([
  // JS/TS
  "function","const","let","var","if","else","for","while","do","return",
  "import","export","from","class","extends","new","this","typeof","instanceof",
  "async","await","try","catch","finally","throw","switch","case","break",
  "continue","default","yield","static","interface","type","enum",
  // Rust
  "struct","impl","fn","pub","mod","use","match","mut","ref","trait","where","crate","super",
  // Python
  "def","self","lambda","with","as","in","not","and","or","elif","pass","raise","except",
  // Go
  "func","package","go","defer","chan","select","range","map","make",
  // Common values
  "true","false","null","undefined","void","None","True","False",
  "int","float","string","bool","boolean",
]);

/**
 * Simple syntax highlighter for code blocks.
 * Tokenizes strings/comments first, then colors keywords/numbers in code.
 */
export function highlightCode(line: string, palette: TerminalPalette): string {
  // Full-line comment (// or #)
  const commentMatch = line.match(/^(\s*)(\/\/.*|#.*)$/);
  if (commentMatch) {
    return `${commentMatch[1]}${DIM}${commentMatch[2]}${RESET}`;
  }

  // Tokenize: split into strings, comments, and code segments
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++; // skip escaped
        j++;
      }
      j = Math.min(j + 1, line.length);
      result.push(`${fg(palette.green)}${line.slice(i, j)}${RESET}`);
      i = j;
      continue;
    }

    // Inline comment //
    if (ch === '/' && line[i + 1] === '/') {
      result.push(`${DIM}${line.slice(i)}${RESET}`);
      break;
    }

    // Number literal
    if (/\d/.test(ch) && (i === 0 || /[\s,([{=+\-*/<>!&|^~%:]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d.xXa-fA-F_]/.test(line[j])) j++;
      result.push(`${fg(palette.yellow)}${line.slice(i, j)}${RESET}`);
      i = j;
      continue;
    }

    // Word (potential keyword)
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < line.length && /[\w$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        result.push(`${fg(palette.accent)}${word}${RESET}`);
      } else {
        result.push(word);
      }
      i = j;
      continue;
    }

    result.push(ch);
    i++;
  }
  return result.join("");
}

// ── List numbering helpers (matching CLI) ─────────────────────────

function numberToLetter(n: number): string {
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],
  [50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"],
];

function numberToRoman(n: number): string {
  let result = "";
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) { result += numeral; n -= value; }
  }
  return result;
}

/** Format ordered list number by depth: numbers → letters → roman numerals */
export function getListNumber(depth: number, num: number): string {
  switch (depth) {
    case 0: case 1: return num.toString();
    case 2: return numberToLetter(num);
    case 3: return numberToRoman(num);
    default: return num.toString();
  }
}

/**
 * Format a single line of markdown into ANSI.
 * Matches Claude Code CLI rendering: headers (bold), lists (- prefix),
 * block quotes (│ dim), tables (| aligned), and inline formatting.
 */
export function formatMarkdownLine(line: string, palette: TerminalPalette): string {
  // Headers: # text, ## text, ### text
  // CLI: H1 = bold+italic+underline, H2+ = bold, all followed by blank line
  const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const text = inlineMarkdown(headerMatch[2], palette);
    if (level === 1) return `${BOLD}${ITALIC}${UNDERLINE}${text}${RESET}`;
    return `${BOLD}${text}${BOLD_OFF}`;
  }

  // Block quotes: > text → dim │ italic text
  const quoteMatch = line.match(/^(\s*)>\s?(.*)/);
  if (quoteMatch) {
    const inner = quoteMatch[2];
    if (!inner.trim()) return `${DIM}\u2502${RESET}`;
    const text = inlineMarkdown(inner, palette);
    return `${DIM}\u2502${RESET} ${ITALIC}${text}${ITALIC_OFF}`;
  }

  // Bullet lists: - text or * text (with optional indent)
  // CLI uses simple "-" prefix with indentation
  const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)/);
  if (bulletMatch) {
    const indent = bulletMatch[1];
    const text = inlineMarkdown(bulletMatch[3], palette);
    return `${indent}- ${text}`;
  }

  // Numbered lists: 1. text — with depth-based numbering (numbers → letters → roman)
  const numMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
  if (numMatch) {
    const indent = numMatch[1];
    const num = parseInt(numMatch[2], 10);
    const depth = Math.floor(indent.length / 2);
    const label = getListNumber(depth, num);
    const text = inlineMarkdown(numMatch[3], palette);
    return `${indent}${label}. ${text}`;
  }

  // Horizontal rule: ---, ***, ___
  if (/^(\s*)([-*_])\2{2,}\s*$/.test(line)) {
    return `${DIM}${"─".repeat(40)}${RESET}`;
  }

  // Table separator: |---|---|
  if (/^\|[\s\-:|]+\|$/.test(line)) {
    // Calculate separator width from column count
    const cols = line.split("|").length - 2;
    const sep = "-".repeat(cols > 0 ? Math.max(3, Math.floor(40 / cols)) : 10);
    return `|${Array(cols).fill(sep).map(s => `-${s}-`).join("|")}|`;
  }

  // Table row: | cell | cell |
  if (line.startsWith("|") && line.endsWith("|")) {
    const cells = line.slice(1, -1).split("|").map(c => ` ${inlineMarkdown(c.trim(), palette)} `);
    return `|${cells.join("|")}|`;
  }

  // Regular line: inline markdown only
  return inlineMarkdown(line, palette);
}

// ── Diff formatting ────────────────────────────────────────────────

/**
 * Format a unified diff string into colored ANSI lines.
 */
export function formatDiff(diffText: string, palette: TerminalPalette): string[] {
  return diffText.split("\n").map(line => {
    if (line.startsWith("+")) return `${fg(palette.green)}${line}${RESET}`;
    if (line.startsWith("-")) return `${fg(palette.red)}${line}${RESET}`;
    if (line.startsWith("@@")) return `${fg(palette.accent)}${line}${RESET}`;
    return `${fg(palette.textDim)}${line}${RESET}`;
  });
}

// ── Horizontal rule ────────────────────────────────────────────────

export function horizontalRule(text: string, cols: number, color: string): string {
  const textLen = text.length + 2; // space padding
  const sideLen = Math.max(2, Math.floor((cols - textLen) / 2));
  const dash = "\u2500";
  return `${fg(color)}${dash.repeat(sideLen)} ${text} ${dash.repeat(sideLen)}${RESET}`;
}

// ── Icon sets ─────────────────────────────────────────────────────

export interface IconSet {
  pending: string;
  success: string;
  fail: string;
  prompt: string;
  thinking: string;
  warning: string;
  arrow_right: string;
  arrow_down: string;
  bullet: string;
  spinner: string[];
}

const ICON_PRESETS: Record<string, IconSet> = {
  default: {
    pending: "\u25cb",   // ○
    success: "\u2713",   // ✓
    fail: "\u2717",      // ✗
    prompt: "\u276f",    // ❯
    thinking: "\u25c9",  // ◉
    warning: "\u26a0",   // ⚠
    arrow_right: "\u25b8", // ▸
    arrow_down: "\u25be",  // ▾
    bullet: "\u25cf",    // ●
    spinner: ["\u00b7", "\u2722", "\u2733", "\u2736", "\u273b", "\u273d"], // · ✢ ✳ ✶ ✻ ✽
  },
  minimal: {
    pending: "o",
    success: "+",
    fail: "x",
    prompt: ">",
    thinking: "*",
    warning: "!",
    arrow_right: ">",
    arrow_down: "v",
    bullet: "*",
    spinner: ["-", "\\", "|", "/"],
  },
  retro: {
    pending: "\u25a1",   // □
    success: "\u221a",   // √
    fail: "\u00d7",      // ×
    prompt: "\u25ba",    // ►
    thinking: "\u2666",  // ♦
    warning: "\u203c",   // ‼
    arrow_right: "\u25ba", // ►
    arrow_down: "\u25bc",  // ▼
    bullet: "\u25a0",    // ■
    spinner: ["\u2591", "\u2592", "\u2593", "\u2588", "\u2593", "\u2592"], // ░ ▒ ▓ █ ▓ ▒
  },
  nerd: {
    pending: "\uf111",   //  (nf-fa-circle)
    success: "\uf00c",   //  (nf-fa-check)
    fail: "\uf00d",      //  (nf-fa-times)
    prompt: "\ue285",    //  (nf-custom-right_arrow)
    thinking: "\uf013",  //  (nf-fa-gear)
    warning: "\uf071",   //  (nf-fa-warning)
    arrow_right: "\ue0b1", //  (nf-pl-right_soft_divider)
    arrow_down: "\uf0d7",  //  (nf-fa-caret_down)
    bullet: "\uf444",    //  (nf-oct-dot_fill)
    spinner: ["\uf110", "\uf110", "\uf110", "\uf110"], //  spinner
  },
  emoji: {
    pending: "\u23f3",   // ⏳
    success: "\u2705",   // ✅
    fail: "\u274c",      // ❌
    prompt: "\u27a4",    // ➤
    thinking: "\ud83d\udca1", // 💡
    warning: "\u26a0\ufe0f",  // ⚠️
    arrow_right: "\u25b6\ufe0f", // ▶️
    arrow_down: "\ud83d\udd3d",  // 🔽
    bullet: "\ud83d\udd35", // 🔵
    spinner: ["\ud83c\udf00", "\ud83c\udf00", "\ud83c\udf00", "\ud83c\udf00"], // 🌀
  },
};

/** Resolve icon set: preset name, custom overrides, or fallback to default */
export function resolveIconSet(preset?: string, overrides?: Partial<IconSet>): IconSet {
  if (preset && !ICON_PRESETS[preset]) {
    console.warn(`Unknown icon preset "${preset}", falling back to "default"`);
  }
  const base = ICON_PRESETS[preset || "default"] || ICON_PRESETS.default;
  if (!overrides) return base;
  const merged = { ...base, ...overrides };
  // Sanitize icon strings to prevent escape injection from theme JSON
  for (const key of Object.keys(merged) as (keyof IconSet)[]) {
    const val = merged[key];
    if (typeof val === "string") {
      (merged as Record<string, unknown>)[key] = val.replace(/\x1b/g, "");
    } else if (Array.isArray(val)) {
      (merged as Record<string, unknown>)[key] = val.map(s => s.replace(/\x1b/g, ""));
    }
  }
  return merged;
}

/** Build spinner frames from an icon set's spinner chars */
export function buildSpinnerFrames(icons: IconSet): string[] {
  const chars = Array.isArray(icons.spinner) ? icons.spinner : [icons.spinner as unknown as string];
  return [...chars, ...[...chars].reverse().slice(1)];
}

// Default icon set (backward-compatible — used when palette.icons is not available)
export const ICON = ICON_PRESETS.default;

/** Random spinner verbs — context-aware processing indicators */
const SPINNER_VERBS = [
  "Thinking...", "Analyzing...", "Reasoning...", "Considering...",
  "Processing...", "Evaluating...", "Working...", "Examining...",
  "Reviewing...", "Computing...", "Investigating...", "Figuring out...",
  "Pondering...", "Exploring...", "Mapping out...", "Connecting dots...",
];
export function randomSpinnerVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
}

/** Interpolate between two hex colors. t=0 → hex1, t=1 → hex2. */
export function interpolateColor(hex1: string, hex2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  const r = clamp(r1 + (r2 - r1) * t);
  const g = clamp(g1 + (g2 - g1) * t);
  const b = clamp(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
