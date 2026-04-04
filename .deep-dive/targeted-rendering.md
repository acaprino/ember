# Claude Code Terminal Rendering & Markdown System -- Deep Dive

Analysis of the rendering pipeline from `@anthropic-ai/claude-code` (reference CLI).
Source: `C:\Users\alfio\Downloads\aaa\src\`

---

## 1. Markdown Parsing Pipeline

### Library & Configuration

**File:** `src/utils/markdown.ts`

Uses the `marked` library (GFM-flavored) with one custom override:

```ts
// markdown.ts:27-33 -- Strikethrough disabled
marked.use({
  tokenizer: {
    del() { return undefined },
  },
})
```

Rationale: the model uses `~` for "approximate" (e.g., `~100`) far more often than
actual strikethrough, so `del` tokens are suppressed.

### Entry Points

1. **`applyMarkdown(content, theme, highlight)`** (markdown.ts:36-47)
   - Strips prompt XML tags via `stripPromptXMLTags`
   - Runs `marked.lexer()` to get token array
   - Maps each token through `formatToken()` and joins as a single string
   - Returns trimmed ANSI string

2. **`<Markdown>` component** (Markdown.tsx:78-171)
   - Hybrid approach: tables render as React components, everything else as ANSI strings
   - Tokens are split: `table` tokens go to `<MarkdownTable>`, all others go through `formatToken()` and render via `<Ansi>`
   - Uses a **module-level LRU token cache** (max 500 entries, keyed by content hash) to avoid re-parsing on virtual-scroll remounts

3. **`<StreamingMarkdown>`** (Markdown.tsx:186-234)
   - Splits at the last top-level block boundary
   - Everything before the boundary is "stable" (memoized, never re-parsed)
   - Only the final growing block is re-parsed per streaming delta
   - Boundary only advances (monotonic) -- safe under StrictMode double-render

### Fast-Path Optimization

```ts
// Markdown.tsx:30-35
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /
```

If the first 500 characters contain no markdown syntax characters, the text bypasses
`marked.lexer()` entirely and is wrapped in a synthetic paragraph token. This saves
the ~3ms lexer cost for plain-text responses.

### Token Rendering (`formatToken`)

**File:** `src/utils/markdown.ts:49-280`

The `formatToken` function is a recursive switch on `token.type`:

| Token Type    | Rendering                                                              | Line |
|---------------|------------------------------------------------------------------------|------|
| `blockquote`  | Dim vertical bar (`\u258e`) prefix + italic text per line              | 58   |
| `code`        | Syntax-highlighted via `cli-highlight` if available, else raw text     | 72   |
| `codespan`    | Inline code colored with `permission` theme color                      | 88   |
| `em`          | `chalk.italic()`                                                       | 92   |
| `strong`      | `chalk.bold()`                                                         | 98   |
| `heading`     | h1: bold+italic+underline; h2+h3: bold. All followed by double EOL    | 104  |
| `hr`          | Literal `---`                                                          | 137  |
| `image`       | Just the href URL                                                      | 139  |
| `link`        | OSC 8 hyperlink via `createHyperlink()`. mailto: rendered as plain text| 141  |
| `list`        | Delegates to list_item, tracks ordered vs unordered                    | 162  |
| `list_item`   | Indented by `listDepth * 2` spaces                                     | 176  |
| `paragraph`   | Joined inline tokens + EOL                                             | 183  |
| `text`        | In list_item: bullet/number prefix. Otherwise: linkifies issue refs    | 193  |
| `table`       | Full table rendering with column alignment and pipe borders            | 205  |
| `escape`      | Raw escaped character                                                  | 270  |
| `def/del/html`| Not rendered (empty string)                                            | 273  |

### Nested List Numbering

Lists cycle through numbering styles by depth (markdown.ts:347-359):

- Depth 0-1: Arabic numerals (1, 2, 3)
- Depth 2: Letters (a, b, c)
- Depth 3: Roman numerals (i, ii, iii)
- Depth 4+: Falls back to Arabic

### Issue Reference Linkification

```ts
// markdown.ts:289-290
const ISSUE_REF_PATTERN = /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g
```

Only qualified `owner/repo#NNN` references are linkified (bare `#NNN` was removed).
Owner segment disallows dots to avoid false positives on hostnames like `docs.github.io/guide#42`.

### Hyperlinks (OSC 8)

**File:** `src/utils/hyperlink.ts`

```
Format: \x1b]8;;URL\x07COLORED_TEXT\x1b]8;;\x07
```

- Display text is colored with `chalk.blue()` (basic ANSI blue, not RGB -- wrap-ansi
  preserves basic ANSI but not RGB colors across line breaks with OSC 8)
- Falls back to plain URL text when terminal doesn't support hyperlinks
- Support detection: `supports-hyperlinks` lib + additional terminals (Ghostty, Hyper,
  Kitty, Alacritty, iTerm2) checked via `TERM_PROGRAM` and `LC_TERMINAL` env vars

---

## 2. Table Formatting Algorithm

### Simple Table (in `formatToken`, markdown.ts:205-269)

For the ANSI-string path (non-React), tables use pipe-delimited format:

1. **Column width calculation**: max `stringWidth` of header and all rows per column, min 3
2. **Alignment-aware padding**: `padAligned()` function (markdown.ts:366-381) handles left/center/right
3. **Output**: `| content | content |` with separator row of dashes

### React Table Component (`MarkdownTable.tsx`)

**File:** `src/components/MarkdownTable.tsx:72-320`

This is the sophisticated responsive table renderer used by the `<Markdown>` component.

#### Constants

- `SAFETY_MARGIN = 4` -- prevents overflow flickering during terminal resize
- `MIN_COLUMN_WIDTH = 3` -- prevents degenerate layouts
- `MAX_ROW_LINES = 4` -- above this, switches to vertical (key-value) format

#### 3-Step Column Width Distribution

**Step 1: Measure** (lines 107-121)

For each column, compute two widths across ALL cells (header + rows):
- `minWidths[col]` = longest single word in any cell (via `getMinWidth()`)
- `idealWidths[col]` = full content width without wrapping (via `getIdealWidth()`)

Both use `stringWidth()` on ANSI-stripped text. Minimum is `MIN_COLUMN_WIDTH` (3).

**Step 2: Available space** (lines 124-128)

```
borderOverhead = 1 + numCols * 3    // vertical bars + cell padding
availableWidth = max(terminalWidth - borderOverhead - SAFETY_MARGIN, numCols * MIN_COLUMN_WIDTH)
```

**Step 3: Distribute** (lines 130-156)

Three cases:
1. **`totalIdeal <= availableWidth`**: Use ideal widths (no wrapping needed)
2. **`totalMin <= availableWidth`**: Each column gets its min width, extra space distributed
   proportionally based on each column's overflow (`ideal - min`)
3. **`totalMin > availableWidth`**: Scale all columns proportionally down from min widths.
   Sets `needsHardWrap = true` so words can be broken mid-word.

```ts
// Case 2 proportional distribution (lines 142-149)
const extraSpace = availableWidth - totalMin
const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i])
const totalOverflow = overflows.reduce((sum, o) => sum + o, 0)
columnWidths = minWidths.map((min, i) => {
  if (totalOverflow === 0) return min
  const extra = Math.floor(overflows[i] / totalOverflow * extraSpace)
  return min + extra
})
```

#### Vertical Format Fallback

When `calculateMaxRowLines() > MAX_ROW_LINES` (4), the table switches to a vertical
key-value layout (lines 241-288):

```
Header1: value1
Header2: value2
────────────────────────
Header1: value3
Header2: value4
```

- First line is narrower (label takes space), continuation lines get wider indent
- Two-pass wrapping: first pass at narrow width, then re-wrap remaining text at continuation width

#### Box-Drawing Characters

Horizontal borders use box-drawing characters (lines 226-238):

| Position | Left | Horizontal | Cross | Right |
|----------|------|------------|-------|-------|
| Top      | `\u250c` | `\u2500` | `\u252c` | `\u2510` |
| Middle   | `\u251c` | `\u2500` | `\u253c` | `\u2524` |
| Bottom   | `\u2514` | `\u2500` | `\u2534` | `\u2518` |

Vertical borders: `\u2502` (lines 209, 218)

#### Multi-Line Cell Rendering

Each cell's content is ANSI-aware wrapped via `wrapText()` (which calls `wrapAnsi()`).
Cells within a row are vertically centered (lines 203-204):

```ts
const verticalOffsets = cellLines.map(lines => Math.floor((maxLines - lines.length) / 2))
```

Headers are always center-aligned; data cells use the table's column alignment.

#### Safety Check

After building all lines, a final safety check (lines 311-317) verifies no line exceeds
`terminalWidth - SAFETY_MARGIN`. If it does (terminal resize race), falls back to
vertical format.

---

## 3. Code Block Highlighting

### Primary Path: `cli-highlight` (lazy loaded)

**File:** `src/utils/cliHighlight.ts`

- `cli-highlight` + `highlight.js` are loaded asynchronously via `import()`
- Shared promise across all consumers; React `use()` suspends until loaded
- Suspense fallback renders markdown without highlighting

### Usage in `formatToken`

```ts
// markdown.ts:72-87
case 'code':
  if (!highlight) return token.text + EOL
  let language = 'plaintext'
  if (token.lang && highlight.supportsLanguage(token.lang)) {
    language = token.lang
  }
  return highlight.highlight(token.text, { language }) + EOL
```

### Native Diff Highlighting: `color-diff-napi`

**File:** `src/components/StructuredDiff/colorDiff.ts`

For structured diffs, a separate native module (`color-diff-napi`) provides:
- `ColorDiff(patch, firstLine, filePath, fileContent).render(theme, width, dim)` -- returns
  array of ANSI-formatted lines
- `ColorFile(code, filePath)` -- for standalone code display
- `getSyntaxTheme(themeName)` -- maps theme names to syntax highlighting palettes
- Can be disabled via `CLAUDE_CODE_SYNTAX_HIGHLIGHT=false` env var

### Diff Display

**File:** `src/components/StructuredDiff.tsx`

- Uses `WeakMap<StructuredPatchHunk, Map<string, CachedRender>>` for caching
- Pre-splits gutter (line numbers) and content columns via `sliceAnsi()`
- Gutter width: `max(oldStart + oldLines - 1, newStart + newLines - 1).toString().length + 3`
- In fullscreen mode, gutter is wrapped in `<NoSelect>` to prevent copying line numbers

---

## 4. Terminal I/O Primitives

### ANSI Control Characters (`termio/ansi.ts`)

C0 control characters defined as numeric constants:

| Constant | Value | Purpose |
|----------|-------|---------|
| `ESC`    | `0x1b`| Escape sequence introducer |
| `BEL`    | `0x07`| Bell / OSC terminator |
| `LF`     | `0x0a`| Line feed |
| `CR`     | `0x0d`| Carriage return |
| `BS`     | `0x08`| Backspace |
| `DEL`    | `0x7f`| Delete |

Escape sequence type introducers (byte after ESC):
- `CSI`: `0x5b` (`[`) -- Control Sequence Introducer
- `OSC`: `0x5d` (`]`) -- Operating System Command
- `DCS`: `0x50` (`P`) -- Device Control String
- `ST`:  `0x5c` (`\`) -- String Terminator

### CSI Sequences (`termio/csi.ts`)

Generator function:
```ts
function csi(...args: (string | number)[]): string
// csi(31, 'm') => "\x1b[31m"
// csi(2, 4, 'H') => "\x1b[2;4H"
```

**Cursor movement** (lines 128-184):
- `cursorUp(n)` = `CSI n A`
- `cursorDown(n)` = `CSI n B`
- `cursorForward(n)` = `CSI n C`
- `cursorBack(n)` = `CSI n D`
- `cursorTo(col)` = `CSI col G` (1-indexed)
- `cursorPosition(row, col)` = `CSI row;col H`
- `cursorMove(x, y)` = combines horizontal + vertical

**Erase** (lines 196-250):
- `eraseToEndOfLine()` = `CSI K`
- `eraseLine()` = `CSI 2 K`
- `eraseScreen()` = `CSI 2 J`
- `eraseLines(n)` = loops: erase line + cursor up, ending at column 1

**Scroll** (lines 254-270):
- `scrollUp(n)` = `CSI n S`
- `scrollDown(n)` = `CSI n T`
- `setScrollRegion(top, bottom)` = `CSI top;bottom r` (DECSTBM)

**Input Protocols** (lines 293-319):
- Kitty keyboard: `CSI > 1 u` (enable) / `CSI < u` (disable)
- Bracketed paste: `CSI 200 ~` (start) / `CSI 201 ~` (end)
- Focus events: `CSI I` (focus in) / `CSI O` (focus out)
- xterm modifyOtherKeys: `CSI > 4;2 m` (enable)

### DEC Private Modes (`termio/dec.ts`)

| Mode | Number | Sequence |
|------|--------|----------|
| Cursor visible | 25 | `CSI ? 25 h/l` |
| Alt screen + clear | 1049 | `CSI ? 1049 h/l` |
| Mouse normal | 1000 | `CSI ? 1000 h/l` |
| Mouse button | 1002 | `CSI ? 1002 h/l` |
| Mouse any-event | 1003 | `CSI ? 1003 h/l` |
| Mouse SGR format | 1006 | `CSI ? 1006 h/l` |
| Focus events | 1004 | `CSI ? 1004 h/l` |
| Bracketed paste | 2004 | `CSI ? 2004 h/l` |
| Synchronized update | 2026 | `CSI ? 2026 h/l` |

Pre-generated constants: `BSU`/`ESU` (begin/end sync update), `HIDE_CURSOR`/`SHOW_CURSOR`,
`ENTER_ALT_SCREEN`/`EXIT_ALT_SCREEN`, `ENABLE_MOUSE_TRACKING`/`DISABLE_MOUSE_TRACKING`.

### OSC Sequences (`termio/osc.ts`)

OSC command numbers (lines 229-249):
- `0` = set title + icon name
- `2` = set title
- `7` = set CWD
- `8` = hyperlinks
- `52` = clipboard (base64-encoded content)
- `133` = semantic prompt
- `21337` = tab status (custom extension)

**Clipboard (OSC 52):**
Multi-layer write strategy (lines 138-158):
1. Native clipboard tool (pbcopy/wl-copy/xclip/clip.exe) fired first, in parallel
2. `tmux load-buffer -w -` if inside tmux (loads buffer + propagates via tmux's own OSC 52)
3. Raw OSC 52 or DCS-passthrough-wrapped OSC 52 returned for stdout write

**Tab Status (OSC 21337):**
Custom extension for per-tab metadata: `indicator` (color dot), `status` (text), `statusColor`.
Semicolons and backslashes in values are escaped.

### ESC Sequences (`termio/esc.ts`)

Simple two-character sequences:
- `ESC c` = Full terminal reset (RIS)
- `ESC 7` / `ESC 8` = Save/restore cursor (DECSC/DECRC)
- `ESC D` = Index (cursor down)
- `ESC M` = Reverse index (cursor up)
- `ESC E` = Next line (NEL)
- `ESC ( X` / `ESC ) X` = Charset selection (silently ignored)

### Input Tokenizer (`termio/tokenize.ts`)

**Streaming state machine** with states: `ground`, `escape`, `escapeIntermediate`, `csi`,
`ss3`, `osc`, `dcs`, `apc`.

Key design:
- `createTokenizer()` returns a stateful tokenizer with `feed(input)` and `flush()` methods
- Incomplete sequences are buffered across calls
- X10 mouse mode is opt-in (only for stdin) because `CSI M` is also Delete Lines in output

### Semantic Parser (`termio/parser.ts`)

The `Parser` class wraps the tokenizer and produces semantic `Action` objects:

```ts
class Parser {
  style: TextStyle = defaultStyle()
  inLink = false
  linkUrl: string | undefined
  feed(input: string): Action[]
}
```

**SGR state is maintained across calls** -- the parser tracks current text style and applies
it to all text actions. SGR sequences update the style but don't emit actions themselves.

Text is segmented into graphemes using `Intl.Segmenter` with width calculation:
- Multi-codepoint graphemes = width 2
- Emoji + East Asian Wide = width 2
- Everything else = width 1

---

## 5. String Width Calculation

**File:** `src/ink/stringWidth.ts`

Three-tier strategy:

1. **Fast path: pure ASCII** (lines 26-45) -- O(n) charCode scan, counts printable chars
2. **Simple Unicode** (lines 56-65) -- no emoji/variation selectors/ZWJ, uses `eastAsianWidth()` per character
3. **Full grapheme segmentation** (lines 67-88) -- `Intl.Segmenter` + emoji regex for complex scripts

Zero-width character detection (lines 129-203) handles:
- Control chars, combining diacritical marks (multiple Unicode ranges)
- Zero-width spaces/joiners (U+200B-200D, U+FEFF, U+2060-2064)
- Variation selectors (U+FE00-FE0F, U+E0100-E01EF)
- Indic script combining marks (Devanagari through Malayalam)
- Thai/Lao combining marks
- Arabic formatting characters

Emoji width: most = 2, regional indicators (single) = 1, incomplete keycap sequences = 1.

**Runtime selection** (line 220): uses `Bun.stringWidth` if available (native), otherwise
the JavaScript implementation.

### ANSI-Aware Text Wrapping

**File:** `src/ink/wrapAnsi.ts`

Thin wrapper that uses `Bun.wrapAnsi` if available, otherwise `wrap-ansi` npm package.
Options: `hard` (break long words), `wordWrap`, `trim`.

---

## 6. Color and Theming System

### Theme Type

**File:** `src/utils/theme.ts:4-89`

The `Theme` type defines ~70 named color keys, all as `string` (RGB format):

**Core colors:** `claude`, `claudeShimmer`, `permission`, `permissionShimmer`, `text`,
`inverseText`, `inactive`, `subtle`, `suggestion`, `background`

**Semantic colors:** `success`, `error`, `warning`, `merged`

**Diff colors:** `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`,
`diffAddedWord`, `diffRemovedWord`

**Agent colors:** 8 named colors for subagents (red, blue, green, yellow, purple, orange, pink, cyan)

**UI colors:** `selectionBg`, `userMessageBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`,
`rate_limit_fill`/`rate_limit_empty`, `fastMode`/`fastModeShimmer`

**Rainbow colors:** 7 rainbow colors + shimmer variants for ultrathink keyword highlighting

### Theme Names

6 built-in themes: `dark`, `light`, `light-daltonized`, `dark-daltonized`, `light-ansi`, `dark-ansi`

Plus `auto` as a setting (resolved at runtime based on system dark/light mode).

### Color Resolution Pipeline

1. **Theme key lookup:** `src/components/design-system/color.ts` -- curried function that
   resolves `keyof Theme` to raw color string via `getTheme(themeName)[key]`
2. **Colorize:** `src/ink/colorize.ts` -- applies chalk formatting based on color format:
   - `ansi:colorName` -- named ANSI colors (16-color palette)
   - `#RRGGBB` -- hex colors via `chalk.hex()`
   - `ansi256(N)` -- 256-color palette
   - `rgb(R,G,B)` -- truecolor via `chalk.rgb()`
3. **Text style application:** `applyTextStyles()` in colorize.ts applies bold/dim/italic/underline/strikethrough/inverse plus fg/bg colors

### Chalk Level Management

**File:** `src/ink/colorize.ts:20-62`

Two adjustments at module load:
1. **VS Code boost:** If `TERM_PROGRAM=vscode` and chalk level is 2, boost to 3 (truecolor).
   VS Code's xterm.js has supported truecolor since 2017 but env detection misses it.
2. **tmux clamp:** If `$TMUX` set and chalk level > 2, clamp to 2. tmux's default config
   doesn't pass through truecolor; 256-color is visually identical.

### SGR (Select Graphic Rendition)

**File:** `src/ink/termio/sgr.ts`

Full SGR parser that handles:
- Basic attributes: bold(1), dim(2), italic(3), underline(4), blink(5/6), inverse(7), hidden(8), strikethrough(9)
- Underline variants: none/single/double/curly/dotted/dashed (via colon-separated subparams)
- Reset codes: 22 (bold+dim off), 23 (italic off), 24 (underline off), etc.
- Named colors: 30-37 (fg), 40-47 (bg), 90-97 (bright fg), 100-107 (bright bg)
- Extended colors: 38;5;N (256-color fg), 48;5;N (256-color bg), 38;2;r;g;b (truecolor)
- Both semicolon (`;`) and colon (`:`) separated parameters
- Underline color: 58;2;r;g;b or 58;5;N

---

## 7. Key UI Components

### Spinner System

**Files:** `src/components/Spinner/`

**SpinnerGlyph** (SpinnerGlyph.tsx):
- Frame characters: `['·', '✢', '✳', '✶', '✻', '✽']` (macOS) or `['·', '✢', '*', '✶', '✻', '✽']` (other)
- Ghostty uses `*` instead of `✽` due to rendering offset
- Frames cycle forward then reverse (bounce animation)
- Stalled state: interpolates color from theme color toward error red `rgb(171,43,63)`
- Reduced motion: single dot `●` with 2-second dim/bright cycle

**GlimmerMessage** (GlimmerMessage.tsx):
- Per-grapheme color animation using `Intl.Segmenter`
- Shimmer effect: glimmer index travels across characters
- Color interpolation between theme `messageColor` and `shimmerColor`
- Stalled intensity shifts colors toward error red

**SpinnerAnimationRow** (SpinnerAnimationRow.tsx):
- Owns `useAnimationFrame(50)` -- the 50ms render loop
- Computes: frame, glimmer index, token counter animation, elapsed time, stalled intensity
- Parent `SpinnerWithVerb` freed from hot animation path (~25x/turn vs ~383x)
- Shows elapsed time + token stats after `SHOW_TOKENS_AFTER_MS` (30 seconds)

### ToolUseLoader

**File:** `src/components/ToolUseLoader.tsx`

Simple blinking circle indicator:
- `BLACK_CIRCLE` (`⏺` on macOS, `●` elsewhere) with `useBlink()` hook
- States: unresolved (dim, blinking), error (red, solid), success (green, solid)
- Warning about chalk dim/bold interaction: `</dim>` and `</bold>` both emit `\x1b[22m` --
  adjacent dim + bold text causes the bold text to inherit dim styling

### Permission Dialog

**File:** `src/components/permissions/PermissionDialog.tsx`

Box with round border (top only), `permission` theme color:
```
borderStyle="round" borderColor={color}
borderLeft={false} borderRight={false} borderBottom={false}
```

Contains: `PermissionRequestTitle` (title + subtitle + optional worker badge) + children content.
Inner padding defaults to 1.

### Structured Diff

**File:** `src/components/StructuredDiff.tsx`

- Receives `StructuredPatchHunk` from the `diff` library
- Pre-renders via `ColorDiff` (native Rust/NAPI module via `color-diff-napi`)
- Caches render output in a `WeakMap` keyed by patch identity + `"theme|width|dim|gutterWidth|firstLine|filePath"`
- Gutter column (line numbers + markers) split from content column via `sliceAnsi()`
- Fullscreen mode: gutter wrapped in `<NoSelect>` to prevent copying line numbers

### File Edit Diff

**File:** `src/components/FileEditToolDiff.tsx`

- Loads diff data asynchronously (reads file, computes patch)
- Uses React `use()` + Suspense for async loading
- Fallback: `<DiffFrame placeholder={true}>` shows skeleton during load
- Delegates to `<StructuredDiffList>` for actual rendering

### Highlighted Code

**File:** `src/components/HighlightedCode.tsx`

- Uses `ColorFile` from `color-diff-napi` for native syntax highlighting
- Measures container width via `measureElement()` for responsive rendering
- Falls back to `<HighlightedCodeFallback>` when native module unavailable
- Syntax highlighting disabled via settings is also respected

### Status Line

**File:** `src/components/StatusLine.tsx`

Builds a comprehensive status object with:
- Model info (id, display name)
- Workspace (current dir, project dir, added dirs)
- Cost tracking (total cost, duration, lines added/removed)
- Context window (input/output tokens, usage percentage)
- Rate limits (5-hour, 7-day utilization)
- Vim mode, agent type, remote session, worktree info
- Rendered by executing a status line command hook

---

## 8. Key Interfaces and Types

### Action Types (`termio/types.ts`)

The parser output is a discriminated union:

```ts
type Action =
  | { type: 'text'; graphemes: Grapheme[]; style: TextStyle }
  | { type: 'cursor'; action: CursorAction }
  | { type: 'erase'; action: EraseAction }
  | { type: 'scroll'; action: ScrollAction }
  | { type: 'mode'; action: ModeAction }
  | { type: 'link'; action: LinkAction }
  | { type: 'title'; action: TitleAction }
  | { type: 'tabStatus'; action: TabStatusAction }
  | { type: 'sgr'; params: string }
  | { type: 'bell' }
  | { type: 'reset' }
  | { type: 'unknown'; sequence: string }
```

### TextStyle (`termio/types.ts:52-65`)

```ts
type TextStyle = {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: UnderlineStyle  // 'none' | 'single' | 'double' | 'curly' | 'dotted' | 'dashed'
  blink: boolean
  inverse: boolean
  hidden: boolean
  strikethrough: boolean
  overline: boolean
  fg: Color
  bg: Color
  underlineColor: Color
}
```

### Color (`termio/types.ts:32-37`)

```ts
type Color =
  | { type: 'named'; name: NamedColor }   // 16-color palette
  | { type: 'indexed'; index: number }      // 0-255
  | { type: 'rgb'; r: number; g: number; b: number }
  | { type: 'default' }
```

### Grapheme (`termio/types.ts:219-222`)

```ts
type Grapheme = {
  value: string
  width: 1 | 2  // Display width in terminal columns
}
```

### ModeAction (`termio/types.ts:167-172`)

```ts
type ModeAction =
  | { type: 'alternateScreen'; enabled: boolean }
  | { type: 'bracketedPaste'; enabled: boolean }
  | { type: 'mouseTracking'; mode: 'off' | 'normal' | 'button' | 'any' }
  | { type: 'focusEvents'; enabled: boolean }
```

### LinkAction (`termio/types.ts:177-179`)

```ts
type LinkAction =
  | { type: 'start'; url: string; params?: Record<string, string> }
  | { type: 'end' }
```

### Theme (`utils/theme.ts:4-89`)

The full Theme interface with ~70 color keys. All values are RGB strings like `'rgb(215,119,87)'`.
Theme names: `'dark' | 'light' | 'light-daltonized' | 'dark-daltonized' | 'light-ansi' | 'dark-ansi'`.

### Unicode Constants (`constants/figures.ts`)

| Constant | Glyph | Unicode | Usage |
|----------|-------|---------|-------|
| `BLACK_CIRCLE` | `⏺`/`●` | platform-dependent | Tool use loader indicator |
| `BULLET_OPERATOR` | `∙` | U+2219 | List bullets |
| `BLOCKQUOTE_BAR` | `▎` | U+258E | Blockquote prefix |
| `HEAVY_HORIZONTAL` | `━` | U+2501 | Separator lines |
| `LIGHTNING_BOLT` | `↯` | U+21AF | Fast mode indicator |
| `EFFORT_LOW/MED/HIGH/MAX` | `○`/`◐`/`●`/`◉` | Various | Effort level |
| `DIAMOND_OPEN/FILLED` | `◇`/`◆` | U+25C7/U+25C6 | Review status |
| `FLAG_ICON` | `⚑` | U+2691 | Issue flag |
| `REFERENCE_MARK` | `※` | U+203B | Away-summary recap |

---

## 9. Implications for xterm.js GUI Replication

### What the CLI renders as ANSI strings

The CLI's `formatToken()` produces raw ANSI strings that Ink's `<Ansi>` component then
parses back into React elements. For an xterm.js-based GUI, you can:

1. **Write ANSI directly to the terminal** -- use the same `formatToken()` output and write
   it to the xterm.js terminal buffer. The terminal handles ANSI natively.

2. **Use the Parser** -- if you need to intercept/transform output, the `Parser` class from
   `termio/parser.ts` produces semantic `Action` objects that you can map to xterm.js operations.

### Table rendering considerations

The CLI's `MarkdownTable` component needs terminal width for responsive layout. In an xterm.js
context, read `terminal.cols` and apply the same 3-step width distribution algorithm.

### Key differences to handle

- The CLI uses `chalk` for ANSI generation; in a browser/xterm.js context, you'll produce
  raw `\x1b[...m` sequences directly or use xterm.js's decoration API
- `cli-highlight` (highlight.js) produces ANSI-colored output; for xterm.js, you can write
  these ANSI strings directly to the terminal
- The `stringWidth()` function is critical for correct column alignment -- xterm.js has its
  own Unicode handling but the width calculation logic here is more comprehensive
