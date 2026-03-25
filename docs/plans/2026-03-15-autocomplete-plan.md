# Intelligent Autocomplete Implementation Plan

> **For agentic workers:** Use subagent-driven execution (if subagents available) or ai-tooling:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ghost-text autocomplete to agent mode terminals — file paths from Rust, LLM suggestions from Haiku via sidecar, Tab to cycle, Right Arrow to accept.

**Architecture:** Two providers (Rust file scanner + sidecar Haiku calls) feed suggestions into a React hook (`useAutocomplete`) that renders ghost text via ANSI escapes into xterm.js. The hook manages debouncing, caching, cycling, and rendering. Settings toggle controls the feature.

**Tech Stack:** React 19, TypeScript, xterm.js 5.5, Rust/Tauri 2, Node.js sidecar, @anthropic-ai/sdk (Haiku)

**Design spec:** `docs/plans/2026-03-15-autocomplete-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/src/hooks/useAutocomplete.ts` | **NEW** — Core hook: debounce, providers, cache, ghost text rendering, cycling |
| `app/src-tauri/src/autocomplete.rs` | **NEW** — Rust file path scanner command |
| `app/src-tauri/src/main.rs` | **MODIFY** — Add `mod autocomplete`, register command |
| `sidecar/sidecar.js` | **MODIFY** — Add `autocomplete` command handler |
| `sidecar/package.json` | **MODIFY** — Add `@anthropic-ai/sdk` dependency |
| `app/src-tauri/src/sidecar.rs` | **MODIFY** — Route `autocomplete` responses |
| `app/src/hooks/useAgentSession.ts` | **MODIFY** — Add `requestAutocomplete()` function |
| `app/src/types.ts` | **MODIFY** — Add `autocomplete_enabled` to Settings |
| `app/src/components/modals/SettingsModal.tsx` | **MODIFY** — Add toggle UI |
| `app/src/components/Terminal.tsx` | **MODIFY** — Integrate hook, key interception |

---

## Chunk 1: Settings & Types Foundation

### Task 1: Add `autocomplete_enabled` to Settings type

**Files:**
- Modify: `app/src/types.ts:34-52`

- [ ] **Step 1: Add the field to the Settings interface**

In `app/src/types.ts`, add `autocomplete_enabled` to the `Settings` interface after the `sidebar_width` field:

```typescript
export interface Settings {
  // ... existing fields ...
  sidebar_width?: number;
  autocomplete_enabled?: boolean;  // default: true when undefined
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/types.ts
git commit -m "feat(autocomplete): add autocomplete_enabled to Settings type"
```

### Task 2: Add autocomplete toggle to SettingsModal

**Files:**
- Modify: `app/src/components/modals/SettingsModal.tsx:223-253`

- [ ] **Step 1: Add the toggle to the Behavior section**

In `SettingsModal.tsx`, add a new toggle row after the "Security gate" toggle (after line 252):

```typescript
          <div className="settings-toggle-row">
            <span>Autocomplete</span>
            <button
              className={`settings-toggle-btn ${settings.autocomplete_enabled !== false ? "active" : ""}`}
              onClick={() => onUpdate({ autocomplete_enabled: !(settings.autocomplete_enabled !== false) })}
            >
              {settings.autocomplete_enabled !== false ? "ON" : "off"}
            </button>
          </div>
```

Note: `settings.autocomplete_enabled !== false` treats `undefined` as `true` (default on).

- [ ] **Step 2: Verify the modal renders correctly**

Run `cargo tauri dev`, open Settings (Ctrl+,), verify the Autocomplete toggle appears in the Behavior section and toggles between ON/off.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/modals/SettingsModal.tsx
git commit -m "feat(autocomplete): add settings toggle in SettingsModal"
```

---

## Chunk 2: Rust File Path Provider

### Task 3: Create the autocomplete.rs file path scanner

**Files:**
- Create: `app/src-tauri/src/autocomplete.rs`

- [ ] **Step 1: Write the Rust file scanner**

Create `app/src-tauri/src/autocomplete.rs`:

```rust
use std::path::Path;

/// Directories to skip when scanning for file path completions.
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", ".next", "dist", "build",
    "__pycache__", ".venv", ".tox", ".mypy_cache",
];

/// Check if user input looks like it contains a file path fragment.
/// Returns the path prefix to complete if found, or None.
fn extract_path_prefix(input: &str) -> Option<&str> {
    // Find the last whitespace — the token after it might be a path
    let token = input.rsplit_once(char::is_whitespace)
        .map(|(_, t)| t)
        .unwrap_or(input);

    // Must contain a slash or start with a known dir prefix
    if token.contains('/') || token.contains('\\') {
        return Some(token);
    }

    // Known directory prefixes that indicate path intent
    const PATH_PREFIXES: &[&str] = &[
        "src", "app", "lib", "test", "tests", "docs", "config",
        "scripts", "pkg", "cmd", "internal", "public", "assets",
    ];
    if PATH_PREFIXES.iter().any(|p| token.starts_with(p)) {
        return Some(token);
    }

    None
}

/// Walk a directory recursively up to a depth limit, collecting files
/// whose relative path starts with the given prefix.
fn collect_matches(
    base: &Path,
    current: &Path,
    prefix: &str,
    depth: usize,
    max_depth: usize,
    results: &mut Vec<String>,
    max_results: usize,
) {
    if depth > max_depth || results.len() >= max_results {
        return;
    }

    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if results.len() >= max_results {
            return;
        }

        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Skip hidden and known noisy directories
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }

        let rel_path = match entry.path().strip_prefix(base) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let rel_lower = rel_path.to_lowercase();
        let prefix_lower = prefix.to_lowercase().replace('\\', "/");

        if rel_lower.starts_with(&prefix_lower) {
            results.push(rel_path.clone());
        }

        // Recurse into directories
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            // Only recurse if this dir could contain matches
            // (the dir path is a prefix of what we're looking for, or vice versa)
            if prefix_lower.starts_with(&rel_lower) || rel_lower.starts_with(&prefix_lower) {
                collect_matches(base, &entry.path(), prefix, depth + 1, max_depth, results, max_results);
            }
        }
    }
}

#[tauri::command]
pub fn autocomplete_files(cwd: String, input: String) -> Result<Vec<String>, String> {
    let prefix = match extract_path_prefix(&input) {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let base = Path::new(&cwd);
    if !base.is_dir() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    collect_matches(base, base, prefix, 0, 5, &mut results, 5);

    // Sort: exact prefix matches first, then alphabetical
    let prefix_lower = prefix.to_lowercase().replace('\\', "/");
    results.sort_by(|a, b| {
        let a_exact = a.to_lowercase().starts_with(&prefix_lower);
        let b_exact = b.to_lowercase().starts_with(&prefix_lower);
        b_exact.cmp(&a_exact).then(a.cmp(b))
    });

    Ok(results)
}
```

- [ ] **Step 2: Register the module and command in main.rs**

In `app/src-tauri/src/main.rs`, add `mod autocomplete;` after the existing module declarations (line 12), and add `commands::autocomplete_files` to the invoke handler... actually, since `autocomplete_files` is defined in `autocomplete.rs` (not in `commands.rs`), register it as `autocomplete::autocomplete_files`:

Add after line 12:
```rust
mod autocomplete;
```

Add to the `invoke_handler` array (after `commands::get_agent_messages`):
```rust
            autocomplete::autocomplete_files,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd app/src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/autocomplete.rs app/src-tauri/src/main.rs
git commit -m "feat(autocomplete): add Rust file path scanner command"
```

---

## Chunk 3: Sidecar LLM Provider

### Task 4: Add @anthropic-ai/sdk dependency to sidecar

**Files:**
- Modify: `sidecar/package.json`

- [ ] **Step 1: Add the dependency**

Edit `sidecar/package.json` to add `@anthropic-ai/sdk`:

```json
{
  "name": "figtree-sidecar",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "sidecar.js",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@anthropic-ai/sdk": "^0.52.0"
  }
}
```

- [ ] **Step 2: Install the dependency**

Run: `cd sidecar && npm install`
Expected: `@anthropic-ai/sdk` installed in node_modules.

- [ ] **Step 3: Commit**

```bash
git add sidecar/package.json
git commit -m "feat(autocomplete): add @anthropic-ai/sdk dependency to sidecar"
```

Note: Do NOT commit `sidecar/node_modules/`. The `sidecar/package-lock.json` may appear as untracked — only commit `package.json`.

### Task 5: Add autocomplete command handler to sidecar

**Files:**
- Modify: `sidecar/sidecar.js`

- [ ] **Step 1: Add the import and handler**

At the top of `sidecar/sidecar.js`, after the existing imports (line 5), add:

```javascript
import Anthropic from "@anthropic-ai/sdk";
```

Before the main loop section (before line 424 `// ── Main loop`), add the autocomplete handler:

```javascript
// ── Autocomplete handler ────────────────────────────────────────────

let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

// Rate limiting: max 10 calls per minute per session
const autocompleteTimestamps = new Map(); // tabId → timestamp[]

function isRateLimited(tabId) {
  const now = Date.now();
  const timestamps = autocompleteTimestamps.get(tabId) || [];
  // Remove timestamps older than 60s
  const recent = timestamps.filter((t) => now - t < 60000);
  autocompleteTimestamps.set(tabId, recent);
  return recent.length >= 10;
}

function recordAutocompleteCall(tabId) {
  const timestamps = autocompleteTimestamps.get(tabId) || [];
  timestamps.push(Date.now());
  autocompleteTimestamps.set(tabId, timestamps);
}

async function handleAutocomplete(cmd) {
  const { tabId, input, context, seq } = cmd;

  // Check rate limit
  if (isRateLimited(tabId)) {
    emit({ evt: "autocomplete", tabId, suggestions: [], seq });
    return;
  }

  recordAutocompleteCall(tabId);

  try {
    const client = getAnthropicClient();

    const messages = [];
    // Add conversation context (last 2-3 messages)
    if (Array.isArray(context)) {
      for (const msg of context.slice(-3)) {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: String(msg.content).slice(0, 500),
        });
      }
    }
    // Add the partial input as the final user message
    messages.push({
      role: "user",
      content: `Complete this partial input: "${input}"`,
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: "You are an autocomplete engine for a coding assistant. Given the user's partial input and recent conversation context, suggest 3 short completions of what they might be typing. Return ONLY a JSON array of 3 strings, each being the completion text (the part that comes AFTER what they already typed). Be concise. Example: if input is \"fix the bug in\", return [\" the auth middleware\", \" src/login.ts\", \" the database connection\"]",
      messages,
    });

    // Parse the response
    const text = response.content[0]?.text || "[]";
    let suggestions;
    try {
      // Extract JSON array from response (may have surrounding text)
      const match = text.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : [];
      // Validate: must be array of strings
      if (!Array.isArray(suggestions) || !suggestions.every((s) => typeof s === "string")) {
        suggestions = [];
      }
    } catch {
      suggestions = [];
    }

    emit({ evt: "autocomplete", tabId, suggestions, seq });
  } catch (err) {
    log(`Autocomplete error for ${tabId}:`, err.message);
    emit({ evt: "autocomplete", tabId, suggestions: [], seq });
  }
}
```

- [ ] **Step 2: Add the command routing**

In the main loop switch statement (around line 468), add a case for `autocomplete` before the `default` case:

```javascript
      case "autocomplete":
        handleAutocomplete(cmd).catch((err) => {
          log(`Autocomplete error: ${err.message}`);
          emit({ evt: "autocomplete", tabId: cmd.tabId, suggestions: [], seq: cmd.seq });
        });
        break;
```

- [ ] **Step 3: Commit**

```bash
git add sidecar/sidecar.js
git commit -m "feat(autocomplete): add LLM autocomplete handler to sidecar"
```

### Task 6: Route autocomplete responses through sidecar.rs

**Files:**
- Modify: `app/src-tauri/src/sidecar.rs:42-93` (SidecarEvent struct)
- Modify: `app/src-tauri/src/sidecar.rs:270-326` (event routing)

- [ ] **Step 1: Add autocomplete fields to SidecarEvent**

In `sidecar.rs`, add to the `SidecarEvent` struct (after the `messages` field, around line 92):

```rust
    // For autocomplete response
    #[serde(default)]
    suggestions: Option<Vec<String>>,
    #[serde(default)]
    seq: u32,
```

- [ ] **Step 2: Add autocomplete event to AgentEvent enum**

In the `AgentEvent` enum (around line 15), add a new variant before `Error`:

```rust
    Autocomplete { suggestions: Vec<String>, seq: u32 },
```

- [ ] **Step 3: Route autocomplete events in the stdout reader**

In the event routing match block (around line 290), add the `autocomplete` case. Since autocomplete events should bypass the normal channel routing and use a oneshot (like `sessions`/`messages`), OR we can route them through the existing channel. The simplest approach: route through the existing channel like other events.

Add after the `"ready"` match arm (around line 314):

```rust
                        "autocomplete" => AgentEvent::Autocomplete {
                            suggestions: event.suggestions.unwrap_or_default(),
                            seq: event.seq,
                        },
```

- [ ] **Step 4: Verify it compiles**

Run: `cd app/src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/sidecar.rs
git commit -m "feat(autocomplete): route autocomplete events through sidecar"
```

### Task 7: Add requestAutocomplete to useAgentSession

**Files:**
- Modify: `app/src/hooks/useAgentSession.ts`

- [ ] **Step 1: Add the function and update AgentEvent type**

In `app/src/types.ts`, add the Autocomplete event type to the `AgentEvent` union (around line 206, before the last entry):

```typescript
  | { type: "autocomplete"; suggestions: string[]; seq: number }
```

In `app/src/hooks/useAgentSession.ts`, add a new exported function after `saveClipboardImage`:

```typescript
export async function requestAutocomplete(
  tabId: string,
  input: string,
  context: Array<{ role: string; content: string }>,
  seq: number,
): Promise<void> {
  await invoke("agent_autocomplete", { tabId, input, context, seq });
}
```

- [ ] **Step 2: Add the Tauri command in commands.rs**

In `app/src-tauri/src/commands.rs`, add a new command that sends the autocomplete request to the sidecar. First, find where other agent commands are defined (like `agent_send`). Add:

```rust
#[tauri::command]
pub fn agent_autocomplete(
    sidecar: State<'_, Arc<SidecarManager>>,
    tab_id: String,
    input: String,
    context: Vec<serde_json::Value>,
    seq: u32,
) -> Result<(), String> {
    sidecar.send_command(&serde_json::json!({
        "cmd": "autocomplete",
        "tabId": tab_id,
        "input": input,
        "context": context,
        "seq": seq,
    }))
}
```

Register in `main.rs` invoke_handler:
```rust
            commands::agent_autocomplete,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd app/src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/types.ts app/src/hooks/useAgentSession.ts app/src-tauri/src/commands.rs app/src-tauri/src/main.rs
git commit -m "feat(autocomplete): add requestAutocomplete IPC bridge"
```

---

## Chunk 4: Core useAutocomplete Hook

### Task 8: Create the useAutocomplete hook

**Files:**
- Create: `app/src/hooks/useAutocomplete.ts`

- [ ] **Step 1: Write the hook**

Create `app/src/hooks/useAutocomplete.ts`:

```typescript
import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { requestAutocomplete } from "./useAgentSession";
import type { Terminal } from "@xterm/xterm";

// ANSI escape helpers
const ESC_SAVE = "\x1b[s";
const ESC_RESTORE = "\x1b[u";
const ESC_ERASE_EOL = "\x1b[K";
const ESC_DIM_ITALIC_GREY = "\x1b[2;3;90m";
const ESC_RESET = "\x1b[0m";

interface CacheEntry {
  suggestions: string[];
  timestamp: number;
  inputSnapshot: string;
}

const CACHE_TTL_MS = 30_000;
const DEBOUNCE_MS = 300;
const MIN_CHARS_FILE = 1;
const MIN_CHARS_LLM = 3;

export interface AutocompleteState {
  /** Ref-based — always current, safe to read in event handlers */
  hasSuggestionRef: React.RefObject<boolean>;
  accept: () => string;
  cycle: () => void;
  dismiss: () => void;
  onInputChange: () => void;
  cleanup: () => void;
  handleResponse: (suggestions: string[], seq: number) => void;
}

export function useAutocomplete(
  xtermRef: React.RefObject<Terminal | null>,
  tabIdRef: React.RefObject<string | null>,
  inputBufRef: React.RefObject<string>,
  projectPath: string,
  enabled: boolean,
  toolIdx: number,
): AutocompleteState {
  const suggestionsRef = useRef<string[]>([]);
  const currentIdxRef = useRef(0);
  // Declared early — used by renderGhost/clearGhost closures below
  const hasSuggestionRef = useRef(false);
  const seqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const ghostVisibleRef = useRef(false);
  const lastGhostLenRef = useRef(0);
  const savedCursorRef = useRef<{ row: number; col: number } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Listen for autocomplete responses via the agent event channel.
  // This is handled in Terminal.tsx where agent events are processed —
  // we expose a handler that Terminal.tsx calls when it receives an
  // autocomplete event. We use a ref callback pattern instead.
  const handleAutocompleteResponse = useCallback((suggestions: string[], seq: number) => {
    if (!enabled) return;
    // Discard stale responses
    if (seq !== seqRef.current) return;

    if (suggestions.length === 0) return;

    // Append LLM suggestions to existing file path suggestions
    const existing = suggestionsRef.current;
    const merged = [...existing, ...suggestions.filter((s) => !existing.includes(s))];
    suggestionsRef.current = merged;

    // If no ghost text is showing yet, render the first suggestion
    if (!ghostVisibleRef.current && merged.length > 0) {
      currentIdxRef.current = 0;
      renderGhost(merged[0], 0, merged.length);
    } else if (ghostVisibleRef.current) {
      // Update the cycle indicator without changing current suggestion
      renderGhost(merged[currentIdxRef.current], currentIdxRef.current, merged.length);
    }
  }, [enabled]);

  // Expose the response handler via ref so Terminal.tsx can call it
  const responseHandlerRef = useRef(handleAutocompleteResponse);
  responseHandlerRef.current = handleAutocompleteResponse;

  const renderGhost = useCallback((suggestion: string, idx: number, total: number) => {
    const xterm = xtermRef.current;
    if (!xterm) return;

    // Save cursor position from JS (not ANSI DECSC — avoids conflicts)
    const row = xterm.buffer.active.cursorY + xterm.buffer.active.baseY + 1; // 1-based for ANSI
    const col = xterm.buffer.active.cursorX + 1; // 1-based

    // Truncate to fit remaining columns
    const availCols = xterm.cols - (col - 1);
    const indicator = total > 1 ? ` (${idx + 1}/${total})` : "";
    let display = suggestion.split("\n")[0]; // First line only
    const maxLen = availCols - indicator.length;
    if (display.length > maxLen) {
      display = display.slice(0, Math.max(0, maxLen - 3)) + "...";
    }

    // Erase previous ghost if any
    if (ghostVisibleRef.current && savedCursorRef.current) {
      const { row: sRow, col: sCol } = savedCursorRef.current;
      xterm.write(`\x1b[${sRow};${sCol}H${ESC_ERASE_EOL}`);
    }

    // Write ghost text
    xterm.write(`\x1b[${row};${col}H${ESC_DIM_ITALIC_GREY}${display}${indicator}${ESC_RESET}`);
    // Restore cursor
    xterm.write(`\x1b[${row};${col}H`);

    savedCursorRef.current = { row, col };
    ghostVisibleRef.current = true;
    hasSuggestionRef.current = true;
    lastGhostLenRef.current = display.length + indicator.length;
  }, [xtermRef]);

  const clearGhost = useCallback(() => {
    if (!ghostVisibleRef.current || !savedCursorRef.current) return;
    const xterm = xtermRef.current;
    if (!xterm) return;

    const { row, col } = savedCursorRef.current;
    xterm.write(`\x1b[${row};${col}H${ESC_ERASE_EOL}`);
    xterm.write(`\x1b[${row};${col}H`);

    ghostVisibleRef.current = false;
    hasSuggestionRef.current = false;
    savedCursorRef.current = null;
    lastGhostLenRef.current = 0;
  }, [xtermRef]);

  const dismiss = useCallback(() => {
    clearGhost();
    suggestionsRef.current = [];
    currentIdxRef.current = 0;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [clearGhost]);

  const cycle = useCallback(() => {
    if (!enabled) return;
    const suggestions = suggestionsRef.current;
    if (suggestions.length === 0) return;

    currentIdxRef.current = (currentIdxRef.current + 1) % suggestions.length;
    renderGhost(suggestions[currentIdxRef.current], currentIdxRef.current, suggestions.length);
  }, [enabled, renderGhost]);

  const accept = useCallback((): string => {
    if (!enabled || suggestionsRef.current.length === 0) return "";
    const suggestion = suggestionsRef.current[currentIdxRef.current] || "";
    clearGhost();
    suggestionsRef.current = [];
    currentIdxRef.current = 0;
    return suggestion;
  }, [enabled, clearGhost]);

  const fetchSuggestions = useCallback(async (input: string) => {
    if (!enabled || !input.trim()) return;

    const newSuggestions: string[] = [];

    // 1. File path provider (Rust backend) — instant
    if (input.length >= MIN_CHARS_FILE) {
      try {
        const files = await invoke<string[]>("autocomplete_files", {
          cwd: projectPath,
          input,
        });
        newSuggestions.push(...files);
      } catch {
        // Silently ignore file scan errors
      }
    }

    // Show file results immediately
    if (newSuggestions.length > 0) {
      suggestionsRef.current = newSuggestions;
      currentIdxRef.current = 0;
      renderGhost(newSuggestions[0], 0, newSuggestions.length);
    }

    // 2. LLM provider — async, only for Claude (toolIdx 0), min 3 chars
    if (input.length >= MIN_CHARS_LLM && toolIdx === 0) {
      // Check cache first
      const cacheKey = input.toLowerCase().trim();
      const cached = cacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        // Verify cache is still relevant
        if (cacheKey.startsWith(cached.inputSnapshot.toLowerCase().trim())) {
          const merged = [...newSuggestions, ...cached.suggestions.filter((s) => !newSuggestions.includes(s))];
          suggestionsRef.current = merged;
          if (merged.length > 0) {
            currentIdxRef.current = 0;
            renderGhost(merged[0], 0, merged.length);
          }
          return;
        }
      }

      // Show loading indicator if no file results are showing yet
      if (newSuggestions.length === 0) {
        const xterm = xtermRef.current;
        if (xterm) {
          const row = xterm.buffer.active.cursorY + xterm.buffer.active.baseY + 1;
          const col = xterm.buffer.active.cursorX + 1;
          savedCursorRef.current = { row, col };
          xterm.write(`\x1b[${row};${col}H${ESC_DIM_ITALIC_GREY}...${ESC_RESET}`);
          xterm.write(`\x1b[${row};${col}H`);
          ghostVisibleRef.current = true;
          lastGhostLenRef.current = 3;
        }
      }

      // Make LLM request
      const seq = ++seqRef.current;
      try {
        await requestAutocomplete(
          tabIdRef.current || "",
          input,
          [], // Context will be enhanced later
          seq,
        );
        // Response comes back via handleAutocompleteResponse (called from Terminal.tsx)
      } catch {
        // Silently ignore LLM errors
      }
    }
  }, [enabled, projectPath, toolIdx, tabIdRef, renderGhost, dismiss]);

  const onInputChange = useCallback(() => {
    if (!enabled) return;

    // Clear existing ghost and debounce timer
    clearGhost();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const input = inputBufRef.current;
      if (input && input.length >= MIN_CHARS_FILE) {
        fetchSuggestions(input);
      }
    }, DEBOUNCE_MS);
  }, [enabled, inputBufRef, clearGhost, fetchSuggestions]);

  const cleanup = useCallback(() => {
    dismiss();
    cacheRef.current.clear();
  }, [dismiss]);

  return {
    hasSuggestionRef,
    accept,
    cycle,
    dismiss,
    onInputChange,
    cleanup,
    handleResponse: (s: string[], seq: number) => responseHandlerRef.current(s, seq),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/hooks/useAutocomplete.ts
git commit -m "feat(autocomplete): create useAutocomplete hook with providers, cache, ghost text"
```

---

## Chunk 5: Terminal Integration

### Task 9: Integrate useAutocomplete into Terminal.tsx

**Files:**
- Modify: `app/src/components/Terminal.tsx`

This is the most complex task — it wires the hook into the terminal's key handling and agent event flow.

- [ ] **Step 1: Add the hook import and initialization**

At the top of `Terminal.tsx`, add the import (after the existing hook imports, around line 8):

```typescript
import { useAutocomplete } from "../hooks/useAutocomplete";
```

Add `autocompleteEnabled` and `toolIdx` to the props interface (the component already receives `toolIdx` as `_toolIdx`). We need to actually use it now. Also add `autocompleteEnabled`:

In the `TerminalProps` interface (around line 140), add:
```typescript
  autocompleteEnabled: boolean;
```

In the component destructuring, change `toolIdx: _toolIdx` to just `toolIdx` and add `autocompleteEnabled`:
```typescript
export default memo(function Terminal({
  tabId,
  projectPath,
  toolIdx,
  modelIdx,
  // ... rest
  autocompleteEnabled,
}: TerminalProps) {
```

Initialize the hook after the existing refs (around line 213):

```typescript
  const autocomplete = useAutocomplete(
    xtermRef,
    tabIdRef,
    agentInputBufRef,
    projectPath,
    autocompleteEnabled,
    toolIdx,
  );
  const autocompleteRef = useRef(autocomplete);
  autocompleteRef.current = autocomplete;
```

- [ ] **Step 2: Add key interception in attachCustomKeyEventHandler**

In the `attachCustomKeyEventHandler` callback (around line 400), add Tab and Right Arrow interception BEFORE the `return true` at the end:

```typescript
      // Autocomplete: Tab cycles, Right Arrow accepts, Esc dismisses
      if (agentInputStateRef.current === "awaiting_input") {
        const ac = autocompleteRef.current;
        const hasGhost = ac.hasSuggestionRef.current;
        if (event.key === "Tab" && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          if (hasGhost) {
            event.preventDefault();
            ac.cycle();
            return false;
          }
        }
        if (event.key === "ArrowRight" && !event.ctrlKey && !event.shiftKey) {
          if (hasGhost) {
            event.preventDefault();
            const accepted = ac.accept();
            if (accepted) {
              agentInputBufRef.current += accepted;
              xtermRef.current?.write(accepted);
            }
            return false;
          }
        }
        if (event.key === "Escape") {
          if (hasGhost) {
            event.preventDefault();
            ac.dismiss();
            return false;
          }
        }
      }
```

- [ ] **Step 3: Integrate dismiss/onInputChange into onData handler**

In the `onData` handler's `awaiting_input` branch (around line 463), modify each input handling path:

For Enter (line 464-482) — add dismiss before processing:
```typescript
        if (data === "\r") {
          autocompleteRef.current.dismiss();
          // ... rest of existing Enter handling unchanged ...
```

For Backspace (line 483-488) — add dismiss:
```typescript
        } else if (data === "\x7f" || data === "\b") {
          autocompleteRef.current.dismiss();
          if (agentInputBufRef.current.length > 0) {
            agentInputBufRef.current = agentInputBufRef.current.slice(0, -1);
            xterm.write("\b \b");
            autocompleteRef.current.onInputChange();
          }
```

For Ctrl+C (line 489-495) — add dismiss:
```typescript
        } else if (data === "\x03") {
          autocompleteRef.current.dismiss();
          // ... rest unchanged ...
```

For regular characters (line 496-499) — add onInputChange after write:
```typescript
        } else if (data.length === 1 && data >= " ") {
          autocompleteRef.current.dismiss();
          agentInputBufRef.current += data;
          xterm.write(data);
          autocompleteRef.current.onInputChange();
```

For paste (line 500-503) — add dismiss and onInputChange:
```typescript
        } else if (data.length > 1 && !data.startsWith("\x1b")) {
          autocompleteRef.current.dismiss();
          agentInputBufRef.current += data;
          xterm.write(data);
          autocompleteRef.current.onInputChange();
        }
```

- [ ] **Step 4: Handle autocomplete events in the agent event handler**

In the `handleAgentEvent` callback (inside the rAF, around line 626), add handling for autocomplete events. Add a case before the existing `if (event.type === "inputRequired")` block:

```typescript
        if (event.type === "autocomplete") {
          autocompleteRef.current.handleResponse(event.suggestions, event.seq);
          return; // Don't render autocomplete events as terminal output
        }
```

- [ ] **Step 5: Dismiss ghost text on resize**

In the ResizeObserver callback (around line 600), add dismiss:

```typescript
    const observer = new ResizeObserver(() => {
      if (resizeRafRef.current) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        if (cancelled) return;
        autocompleteRef.current.dismiss();
        lastResizeTimeRef.current = Date.now();
        fitAddon.fit();
        syncPtySize(true);
      });
    });
```

- [ ] **Step 6: Cleanup on unmount**

In the cleanup return function (around line 763), add:

```typescript
      autocompleteRef.current.cleanup();
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/Terminal.tsx
git commit -m "feat(autocomplete): integrate useAutocomplete hook into Terminal.tsx"
```

### Task 10: Pass autocompleteEnabled prop from parent

**Files:**
- Modify: `app/src/App.tsx:320-340`

- [ ] **Step 1: Add the prop to the Terminal component**

In `app/src/App.tsx`, the `<Terminal>` component is rendered at line 320. The `settings` object is available in scope (line 40: `const { settings, setFilter, updateSettings } = useProjectsContext()`). Add the `autocompleteEnabled` prop after `onTaglineChange` (line 339):

```typescript
                    onTaglineChange={handleTaglineChange}
                    autocompleteEnabled={settings?.autocomplete_enabled !== false}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo tauri dev`
Expected: App starts without errors, Terminal renders correctly.

- [ ] **Step 3: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat(autocomplete): pass autocompleteEnabled prop to Terminal"
```

---

## Chunk 6: Polish & Edge Cases

### Task 11: Add LLM response caching in the hook

**Files:**
- Modify: `app/src/hooks/useAutocomplete.ts`

- [ ] **Step 1: Cache LLM responses when they arrive**

In the `handleAutocompleteResponse` callback, after processing suggestions, cache them:

```typescript
    // Cache the LLM response
    const input = inputBufRef.current;
    if (input && suggestions.length > 0) {
      const cacheKey = input.toLowerCase().trim();
      cacheRef.current.set(cacheKey, {
        suggestions,
        timestamp: Date.now(),
        inputSnapshot: input,
      });
    }
```

- [ ] **Step 2: Commit**

```bash
git add app/src/hooks/useAutocomplete.ts
git commit -m "feat(autocomplete): cache LLM responses with 30s TTL"
```

### Task 12: End-to-end manual test

- [ ] **Step 1: Build and run**

Run: `cargo tauri dev`

- [ ] **Step 2: Test file path completion**

1. Open a project terminal (agent mode)
2. Wait for the `❯` prompt
3. Type `src/` and pause for 300ms
4. Expected: ghost text appears showing a file path like `src/components/Terminal.tsx` in dim italic grey
5. Press Tab — ghost text should cycle to next match
6. Press Right Arrow — suggestion accepted, text appears as normal input

- [ ] **Step 3: Test LLM completion**

1. In the same terminal, type `fix the bug` and pause
2. Expected: after ~300-500ms, ghost text appears with a completion like `in the auth middleware`
3. Tab cycles alternatives
4. Right Arrow accepts

- [ ] **Step 4: Test dismiss behavior**

1. Type some text, wait for ghost text
2. Keep typing — ghost text should disappear
3. Press Esc — ghost text should disappear
4. Press Enter — message should send (NOT accept the suggestion)
5. Press Backspace — ghost text should disappear, then new suggestions after pause

- [ ] **Step 5: Test settings toggle**

1. Open Settings (Ctrl+,)
2. Toggle Autocomplete OFF
3. Type in terminal — no suggestions should appear
4. Toggle back ON — suggestions resume

- [ ] **Step 6: Test with Gemini**

1. Press F1 to switch to Gemini
2. Type a path — file path suggestions should still appear
3. Type regular text — NO LLM suggestions (Gemini sessions skip Haiku calls)

- [ ] **Step 7: Commit any fixes**

Stage only the files you changed, then commit:
```bash
git commit -m "fix(autocomplete): polish from end-to-end testing"
```
