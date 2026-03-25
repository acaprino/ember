# Intelligent Autocomplete System — Design Spec

**Date**: 2026-03-15
**Status**: Approved
**Scope**: Agent mode terminal input only

## Overview

An intelligent autocomplete system for Figtree's agent mode that provides ghost text suggestions as users type messages to Claude/Gemini. Combines instant file path completions (via Rust backend) with context-aware LLM suggestions (via Haiku). Tab cycles through alternatives, Right Arrow accepts.

## Architecture

```
+-------------------------------------+
|  Ghost Text Renderer (xterm ANSI)   |  Renders dimmed suggestion text at cursor
+-------------------------------------+
|  Suggestion Manager (React hook)    |  Manages suggestion list, cycling, debounce
+-------------------------------------+
|  Provider Pipeline                  |  File paths (Rust) + LLM (Haiku) + Cache
+-------------------------------------+
|  Settings Integration               |  Enable/disable toggle in SettingsModal
+-------------------------------------+
```

### Data Flow

1. User types in agent mode -> input buffer updates -> debounce timer starts (300ms)
2. After 300ms idle -> Suggestion Manager queries providers in parallel
3. File path provider (instant): Rust command scans project dir for matches
4. Cache provider (instant): checks for cached LLM suggestions for similar prefix
5. LLM provider (async): sends partial input + recent context to Haiku
6. Results merge into a ranked suggestion list (file paths first, then LLM)
7. Ghost text renderer writes top suggestion as dimmed ANSI text after cursor
8. Tab cycles `suggestionIndex`, updating ghost text
9. Right Arrow accepts -> suggestion text appended to input buffer
10. Any other key -> ghost text erased, normal typing continues

## Ghost Text Rendering

Since xterm.js is canvas-based, ghost text is rendered using ANSI escape codes:

1. **Read cursor position** from `xterm.buffer.active.cursorX` / `cursorY` (JavaScript-side tracking, avoids single-slot DECSC/DECRC conflicts with agent output)
2. **Write dimmed ANSI text**: `\x1b[2;3;90m` (dim + italic + grey) + suggestion + indicator + `\x1b[0m` (reset)
3. **Restore cursor** with absolute positioning `\x1b[{row};{col}H` using the saved coordinates
4. **On next keystroke**: move to saved position with `\x1b[{row};{col}H`, then `\x1b[K` (erase to end of line) to clear all ghost text regardless of length, then process the keystroke normally

**Line-wrap prevention**: Ghost text is truncated to fit remaining columns (`xterm.cols - buffer.cursorX`) to avoid wrapping artifacts. If the suggestion is longer than available space, it is clipped with a trailing `...`.

### Cycling Behavior

- `suggestions: string[]` array with `currentIdx: number`
- Tab increments `currentIdx % suggestions.length`
- Each cycle: save cursor -> erase to end of line -> write new ghost -> restore cursor
- Visual indicator: dim `(1/3)` appended to ghost text showing position in list

### Accept / Dismiss

| Key | Action |
|-----|--------|
| **Tab** | Cycle to next suggestion |
| **Right Arrow** | Accept current suggestion, append to input buffer, write as real text |
| **Esc** | Dismiss all suggestions |
| **Backspace** | Dismiss suggestions, delete last char from buffer, restart debounce |
| **Enter** | Dismiss suggestions (if showing), then submit message normally (existing behavior unchanged) |
| **Paste** (multi-char onData) | Dismiss suggestions, append pasted text to buffer, restart debounce |
| **Any other key** | Dismiss ghost text, append char to buffer, restart debounce |

**Key design decision**: Enter does NOT accept suggestions. It always submits the message (existing behavior). This avoids a confusing double-purpose key. Right Arrow is the only accept key.

### Edge Cases

- Multi-line suggestions: show only first line as ghost, full text on accept
- Empty input: do not trigger autocomplete
- Minimum 3 characters before triggering LLM provider
- File path provider triggers on 1+ characters (instant, no cost)
- **Terminal resize**: dismiss all ghost text immediately on resize event
- **Stale responses**: each autocomplete request carries a sequence number; responses with outdated sequence numbers are discarded silently
- **Malformed LLM response**: parse with try/catch, fall back to empty suggestions, do not cache errors
- **Mid-cycle LLM arrival**: if the user is actively Tab-cycling when LLM suggestions arrive, they are appended to the list but `currentIdx` is preserved (pointing to the same suggestion). The user sees the cycle indicator update (e.g., `(2/3)` -> `(2/6)`) but their current suggestion doesn't jump.

## Provider Pipeline

### 1. File Path Provider (Rust Backend)

New Tauri command:

```rust
#[tauri::command]
pub fn autocomplete_files(cwd: String, prefix: String) -> Result<Vec<String>, String>
```

- Walks project directory, matches partial paths
- Detects path context: input contains `/` or `\` or starts with known dirs (`src/`, `app/`, etc.)
- Returns up to 5 matches, sorted by relevance (exact prefix > fuzzy)
- Ignores: `.git`, `node_modules`, `target`, hidden directories
- New file: `app/src-tauri/src/autocomplete.rs`
- **Latency**: <5ms

### 2. LLM Provider (Sidecar -> Haiku)

New sidecar command:

```json
{ "cmd": "autocomplete", "tabId": "...", "input": "partial text", "context": [...], "seq": 42 }
```

- **SDK dependency**: Add `@anthropic-ai/sdk` as an explicit dependency in `sidecar/package.json` (not rely on transitive hoisting)
- Makes a non-streaming `messages.create()` call to `claude-haiku-4-5-20251001`
- **API key**: Uses `ANTHROPIC_API_KEY` environment variable (same as Claude Code CLI). The `Anthropic()` constructor reads this by default.
- `max_tokens: 150`
- Context: last 2-3 assistant/user messages from the session, trimmed to ~500 tokens
- System prompt: "You are an autocomplete engine. Given the user's partial input and recent conversation, suggest 3 short completions. Return a JSON array of strings. Be concise."
- Returns: `{ evt: "autocomplete", tabId, suggestions: string[], seq: 42 }`
- **Latency**: ~200-400ms
- **Rate limit**: Max 10 LLM autocomplete calls per minute per session. Excess requests are silently dropped.
- **Error handling**: On API error or malformed response, return `{ evt: "autocomplete", tabId, suggestions: [], seq }`. Do not cache errors.

**Gemini sessions**: When the active tool is Gemini (tool_idx = 1), the LLM provider is skipped entirely. File path suggestions still work for all tools.

### 3. Cache Layer

- In-memory `Map<string, { suggestions: string[], timestamp: number, inputSnapshot: string }>`
- Key: full input string (normalized, lowercase, trimmed)
- TTL: 30 seconds
- On cache hit: verify that cached `inputSnapshot` is still a prefix of current input before returning
- On cache miss or stale: make LLM call
- Cache lives in the `useAutocomplete` hook (frontend-side)

### Result Merging

- File path matches arrive instantly -> shown as ghost text immediately
- LLM suggestions arrive async -> appended to suggestion list when ready (if seq matches current)
- File paths always come first in cycle order
- If no file paths match, ghost text waits for LLM with dim `...` loading indicator

### Cost Estimate

Haiku at ~$0.25/MTok input, ~$1.25/MTok output. Each autocomplete call uses ~600 input tokens (system + context) and ~50 output tokens.
- Per call: ~$0.0002
- Per minute (max 10 calls): ~$0.002
- Per hour of active use: ~$0.06
- With caching, real-world cost is significantly lower.

## Integration Points

### Terminal.tsx (Agent Mode Only)

1. **Tab interception** in `attachCustomKeyEventHandler()`: when agent state is `awaiting_input` and suggestions exist, return `false` to prevent xterm from processing Tab, then call `cycle()` on the autocomplete hook
2. **Right Arrow interception** in `attachCustomKeyEventHandler()`: when ghost text is showing, return `false` and call `accept()`
3. **Input buffer listener**: in the `onData()` handler, after updating `agentInputBufRef`, call `onInputChange()` to reset debounce. For multi-char data (paste), call `dismiss()` first.

Note: when `attachCustomKeyEventHandler` returns `false`, the `onData` callback will NOT fire for that key. So the cycle/accept logic must be handled entirely within the key handler.

### New Hook: useAutocomplete

```typescript
// app/src/hooks/useAutocomplete.ts
function useAutocomplete(
  xtermRef: React.RefObject<Terminal>,
  sessionRef: React.RefObject<string>,
  inputBufRef: React.RefObject<string>,
  cwdRef: React.RefObject<string>,
  settings: Settings
): {
  suggestions: string[];
  currentIdx: number;
  isLoading: boolean;
  hasSuggestion: boolean;  // For key handler to check
  accept: () => string;    // Returns accepted text
  cycle: () => void;       // Tab pressed
  dismiss: () => void;     // Esc or typing
  onInputChange: () => void; // Reset debounce
}
```

Encapsulates all autocomplete logic. When `settings.autocomplete_enabled` is false, all methods are no-ops and `hasSuggestion` is always false.

### Tab Key Conflict Resolution

- **NewTabPage**: Tab cycles models — no conflict (autocomplete is agent-mode only)
- **PTY mode**: Tab passes to CLI's own completion — no conflict (autocomplete is agent-mode only)
- **Agent mode**: Tab is currently unused — no conflict

### Settings

New field in `Settings` interface:

```typescript
autocomplete_enabled: boolean;  // default: true
```

Toggle in `SettingsModal.tsx` under a new "Autocomplete" section. Simple on/off switch.

## New Files

| File | Purpose |
|------|---------|
| `app/src/hooks/useAutocomplete.ts` | Main autocomplete hook |
| `app/src-tauri/src/autocomplete.rs` | File path provider (Rust) |

## Modified Files

| File | Change |
|------|--------|
| `app/src/components/Terminal.tsx` | Hook integration, key interception in attachCustomKeyEventHandler and onData |
| `app/src/types.ts` | `autocomplete_enabled` in Settings |
| `app/src/components/modals/SettingsModal.tsx` | Toggle UI |
| `sidecar/sidecar.js` | New `autocomplete` command handler using `@anthropic-ai/sdk` |
| `sidecar/package.json` | Add `@anthropic-ai/sdk` as explicit dependency |
| `app/src-tauri/src/main.rs` | Register `autocomplete_files` command, add `mod autocomplete` |

## Not Changed

- PTY mode behavior
- NewTabPage / project filtering
- Existing keyboard shortcuts
- Agent SDK session flow
- Gemini CLI integration

## Configuration Summary

| Parameter | Value |
|-----------|-------|
| Debounce delay | 300ms idle |
| Min chars (file paths) | 1 |
| Min chars (LLM) | 3 |
| Max suggestions | 5 file paths + 3 LLM = 8 total |
| LLM model | claude-haiku-4-5-20251001 |
| LLM max_tokens | 150 |
| LLM rate limit | 10 calls/min/session |
| Cache TTL | 30 seconds |
| Cache key | Full input (normalized) |
| Ghost text style | Dim + italic + grey (SGR 2;3;90) |
| Ghost text truncation | Clipped to remaining terminal columns |
| Loading indicator | Dim `...` after cursor |
| Cycle indicator | Dim `(1/3)` appended to ghost text |
| Accept key | Right Arrow only |
| Cycle key | Tab |
| Dismiss keys | Esc, Enter, Backspace, any typing |
