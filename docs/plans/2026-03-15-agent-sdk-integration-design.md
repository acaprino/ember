# Agent SDK Integration — Design Spec

## Goal

Integrate `@anthropic-ai/claude-agent-sdk` into Figtree via a Node.js sidecar to replace direct PTY-based Claude CLI spawning with structured SDK-driven sessions. This enables: session history browser (list/resume/fork), enhanced usage tracking with real-time cost data, and full control over terminal rendering.

## Architecture

Figtree adds a Node.js sidecar process that wraps the claude-agent-sdk. The Rust backend communicates with the sidecar via JSON-lines over stdin/stdout (stderr is captured for logging). The frontend receives structured `AgentEvent` objects via Tauri IPC (same channel pattern as current PTY events), formats them as ANSI text, and renders in xterm.js.

Gemini tabs remain on the existing PTY path. Claude tabs migrate to the SDK path. The PTY path is kept as fallback (toggle in settings) during the transition period.

## Build & Bundling

The sidecar requires Node.js at runtime. Strategy:

- **Node.js location**: Figtree looks for `node.exe` on PATH. If not found, checks `%LOCALAPPDATA%\figtree\node\node.exe` (user can install there manually).
- **Sidecar script + node_modules**: Bundled as Tauri resources in `sidecar/`. At build time, `npm install --production` in `sidecar/` produces the `node_modules`. Tauri bundles the entire `sidecar/` directory via `tauri.conf.json` `bundle.resources`.
- **Runtime**: Rust spawns `node.exe sidecar/sidecar.js` (not a Tauri sidecar binary — a regular child process managed by `SidecarManager`).
- **Fallback**: If Node.js is not available, Claude tabs silently use PTY mode (existing path). A warning appears in the status bar: "Node.js not found — using CLI mode".

## Components

### 1. Node.js Sidecar (`sidecar/`)

A standalone Node.js script bundled with Figtree that:
- Imports `@anthropic-ai/claude-agent-sdk`
- Reads JSON-line commands from stdin, writes JSON-line events to stdout
- Logs errors/diagnostics to stderr (captured by Rust for logging)
- Manages a map of `tabId → Query` (SDK session objects)
- Supports commands: `create`, `send`, `resume`, `fork`, `kill`, `list_sessions`, `get_messages`, `set_model`, `permission_response`
- Streams `SDKMessage` events back as they arrive from each session

**Session management**: The SDK provides `listSessions()`, `getSessionMessages()`, `resume`, and `forkSession` as first-class APIs. The sidecar wraps these directly. Session data is stored by Claude Code in `~/.claude/projects/<encoded-cwd>/*.jsonl` — the SDK reads these files internally; the sidecar does not parse them.

**File structure:**
```
sidecar/
  package.json          — deps: @anthropic-ai/claude-agent-sdk
  sidecar.js            — main entry point
```

### 2. Rust Sidecar Manager (`sidecar.rs`)

New module in `app/src-tauri/src/` that:
- Spawns the Node.js sidecar process on app startup
- Sends JSON-line commands to sidecar stdin (every message includes `tabId` for multiplexing)
- Reads JSON-line events from sidecar stdout, routes to appropriate Tauri IPC channels by `tabId`
- Captures stderr and logs via `logging.rs`
- Handles sidecar crash detection (broken pipe) and auto-restart
- Provides `SidecarManager` struct exposed as Tauri managed state

**Key types:**
```rust
pub struct SidecarManager {
    stdin: Mutex<ChildStdin>,
    channels: Mutex<HashMap<String, Channel<AgentEvent>>>,
    process: Mutex<Child>,
    available: AtomicBool, // false if Node.js not found
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AgentEvent {
    Assistant { text: String, streaming: bool },
    ToolUse { tool: String, input: serde_json::Value },
    ToolResult { tool: String, output: String, success: bool },
    Permission { tool: String, description: String },
    Status { status: String, model: String },
    InputRequired {},  // SDK is waiting for user input
    Thinking { text: String },
    Progress { message: String },
    Result { cost: f64, input_tokens: u64, output_tokens: u64, turns: u32, duration_ms: u64 },
    Error { code: String, message: String },
    Exit { code: i32 },
}
```

**JSON-line protocol:**

Commands (Rust → Sidecar), always include `tabId`:
```jsonl
{"cmd":"create","tabId":"uuid","cwd":"/path","model":"sonnet","effort":"high","systemPrompt":"...","allowedTools":["Read","Edit","Bash"],"skipPerms":true}
{"cmd":"send","tabId":"uuid","text":"fix the auth bug"}
{"cmd":"resume","tabId":"uuid","sessionId":"sess-abc123"}
{"cmd":"fork","tabId":"uuid","sessionId":"sess-abc123"}
{"cmd":"kill","tabId":"uuid"}
{"cmd":"set_model","tabId":"uuid","model":"opus"}
{"cmd":"permission_response","tabId":"uuid","allow":true}
{"cmd":"list_sessions","tabId":"_control","cwd":"/path"}
{"cmd":"get_messages","tabId":"_control","sessionId":"sess-abc123"}
```

Events (Sidecar → Rust), always include `tabId`:
```jsonl
{"evt":"assistant","tabId":"uuid","text":"I'll fix...","streaming":true}
{"evt":"tool_use","tabId":"uuid","tool":"Edit","input":{...}}
{"evt":"tool_result","tabId":"uuid","tool":"Edit","output":"✓","success":true}
{"evt":"permission","tabId":"uuid","tool":"Bash","description":"rm -rf /tmp/cache"}
{"evt":"input_required","tabId":"uuid"}
{"evt":"thinking","tabId":"uuid","text":"Analyzing..."}
{"evt":"status","tabId":"uuid","status":"thinking","model":"sonnet"}
{"evt":"result","tabId":"uuid","cost":0.023,"inputTokens":1500,"outputTokens":800,"turns":3,"durationMs":12000}
{"evt":"sessions","tabId":"_control","list":[{"id":"sess-abc","cwd":"/proj","date":"2026-03-15","model":"sonnet","cost":0.45}]}
{"evt":"messages","tabId":"_control","sessionId":"sess-abc","messages":[...]}
{"evt":"error","tabId":"uuid","code":"rate_limit","message":"..."}
{"evt":"exit","tabId":"uuid","code":0}
```

Malformed JSON lines are logged and skipped (no crash).

### 3. Frontend Agent Session Hook (`useAgentSession.ts`)

New hook that mirrors `usePty.ts` but for SDK sessions:
- `spawnAgent(projectPath, model, effort, ...)` → calls Rust `spawn_agent` command
- `sendMessage(sessionId, text)` → sends user input to sidecar
- `resumeSession(sessionId)` → resumes past session
- `forkSession(sessionId)` → forks session
- `respondPermission(sessionId, allow)` → responds to permission prompt
- Events arrive via Tauri Channel (same pattern as `usePty`)

### 4. Input Handling

Agent tabs handle user input differently from PTY tabs:

**Line-buffered input**: The frontend maintains an input buffer. Keystrokes are echoed locally to xterm.js (with the accent-colored prompt `❯`). On Enter, the complete line is sent via `sendMessage()`. This replaces the character-by-character PTY stdin model.

**Input state machine:**
```
IDLE → (input_required event) → AWAITING_INPUT → (user types + Enter) → PROCESSING
PROCESSING → (input_required event) → AWAITING_INPUT
PROCESSING → (permission event) → AWAITING_PERMISSION
AWAITING_PERMISSION → (Y/n key) → respondPermission() → PROCESSING
PROCESSING → (result event) → IDLE or AWAITING_INPUT
any state → (Ctrl+C) → interrupt SDK query → AWAITING_INPUT
```

**In AWAITING_INPUT state:**
- Keystrokes are buffered and echoed to xterm.js
- Arrow keys: left/right for cursor movement within line, up/down for history
- Backspace: delete character, update xterm display
- Enter: send buffer via `sendMessage()`, transition to PROCESSING
- Ctrl+C: clear current input buffer

**In AWAITING_PERMISSION state:**
- Only Y, y, N, n, Enter (default Y) are accepted
- Other keys are ignored
- Response sent via `respondPermission()`

**In PROCESSING state:**
- Ctrl+C sends interrupt to SDK (cancels current query)
- Other keystrokes are ignored (or queued)

### 5. ANSI Renderer (`ansiRenderer.ts`)

Pure function module that converts `AgentEvent` objects to ANSI strings for xterm.js:
- `renderAssistant(text, theme)` → white text, word-wrapped to terminal width
- `renderToolUse(tool, input, theme)` → boxed block in accent color with tool name header
- `renderToolResult(tool, output, success, theme)` → green ✓ or red ✗ with output
- `renderPermission(tool, description, theme)` → yellow ⚠ with Y/n prompt
- `renderStatus(status, theme)` → dim spinner text (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
- `renderThinking(text, theme)` → dim italic thinking text
- `renderResult(cost, tokens, turns, duration, theme)` → dim summary line
- `renderUserPrompt(theme)` → accent-colored `❯ ` prompt character
- `renderInputRequired(theme)` → shows prompt, signals terminal to accept input

### 6. Terminal.tsx Branching

Terminal.tsx uses the tab's `type` field to branch behavior:

**For `type="agent"` tabs:**
- Skip: PTY spawn, ConPTY resize, banner detection (`BANNER_END_RE`), logo injection via PTY write
- Instead: show Figtree logo via direct xterm.write, then wait for SDK events
- Minimap: works the same (reads xterm buffer content, which contains rendered ANSI)
- Resize: terminal resize only affects xterm.js viewport (no PTY to resize)
- Input: managed by input state machine (line-buffered), not forwarded to PTY
- Heartbeat: still sent via Rust `heartbeat` command to keep sidecar session alive
- Cleanup: `killSession` → Rust sends `kill` command to sidecar

**For `type="terminal"` tabs (unchanged):**
- Full PTY path as today (Gemini, or Claude with `use_agent_sdk: false`)

### 7. Session Browser (`SessionBrowser.tsx`)

New tab type `"sessions"` that displays past Claude Code sessions:
- Keyboard-driven list (same pattern as `NewTabPage.tsx`)
- Shows: date, project name, model, cost per session
- Filter by typing, sort by date/project/cost
- **Enter**: view transcript read-only (formatted via ansiRenderer in a new terminal tab)
- **R**: resume session (opens new agent tab with `resume: sessionId`)
- **F**: fork session (opens new agent tab with `forkSession: true`)
- Data comes from sidecar `list_sessions` / `get_messages` commands
- If sidecar unavailable, shows "SDK not available" message

### 8. Enhanced Usage Tab

Extends `UsagePage.tsx` with:
- **By Project** section — aggregates cost/tokens per project `cwd`
- **Live indicator** — shows active SDK sessions with running cost
- **Avg/session** metric in totals

Data sources:
- Historical: existing Rust JSONL parsing (`usage_stats.rs`) extended to group by project
- Live: frontend accumulates `Result` events from active agent sessions in a React context/ref
- When a session ends, its `Result` data is not double-counted — the JSONL files are the source of truth for historical data; live indicators only show running sessions

### 9. Tab Type Extension

`types.ts` Tab type becomes:
```typescript
type: "new-tab" | "terminal" | "agent" | "about" | "usage" | "system-prompt" | "sessions"
```

- `"terminal"` — existing PTY path (used for Gemini, and Claude fallback)
- `"agent"` — new SDK path (used for Claude by default)
- `"sessions"` — session browser (singleton toggle)

## Data Flow

### Agent session lifecycle:
```
1. User selects project in NewTabPage, tool=claude, use_agent_sdk=true
2. Tab created with type="agent"
3. Terminal.tsx detects agent tab → uses input state machine + ansiRenderer
4. Calls invoke("spawn_agent", {...})
5. Rust spawn_agent sends {"cmd":"create","tabId":"...","cwd":"..."} to sidecar stdin
6. Sidecar calls query() from SDK, streams SDKMessage back
7. Sidecar maps SDKMessage to events, writes {"evt":"assistant","tabId":"..."} to stdout
8. Rust reads stdout, routes event to matching Tauri Channel by tabId
9. Terminal.tsx receives AgentEvent, calls ansiRenderer, writes ANSI to xterm.js
10. SDK emits input_required → terminal shows prompt → user types → Enter
11. sendMessage → invoke("agent_send") → Rust sends {"cmd":"send"} to sidecar
12. Sidecar feeds text to SDK streaming input → SDK continues
```

### Permission flow:
```
1. SDK hooks PreToolUse → sidecar emits {"evt":"permission","tabId":"...","tool":"Bash","description":"rm -rf /tmp"}
2. Terminal enters AWAITING_PERMISSION state, renders: ⚠ Allow Bash: rm -rf /tmp? [Y/n]
3. User presses Y → terminal calls respondPermission(tabId, true)
4. invoke("agent_permission") → Rust sends {"cmd":"permission_response","tabId":"...","allow":true}
5. Sidecar resolves the permission hook → SDK continues execution
6. Terminal returns to PROCESSING state
```

## Error Handling

- **Sidecar crash**: Rust detects broken pipe on stdin/stdout, logs error, attempts restart after 2s. Active agent tabs show "⚠ Connection lost — reconnecting..." in terminal. On restart, sessions cannot be auto-resumed (user must re-launch).
- **Sidecar not starting**: If Node.js not found, set `SidecarManager.available = false`. Claude tabs silently use PTY mode. Status bar shows "Node.js not found — using CLI mode".
- **Rate limiting**: SDK emits rate limit event → sidecar emits `{"evt":"error","code":"rate_limit"}` → terminal shows "⏳ Rate limited, retrying in Xs..." in yellow.
- **Permission timeout**: 60s without response → auto-deny, log warning.
- **Session orphans**: Same heartbeat pattern as existing PTY (5s interval, 60s timeout). Sidecar kills SDK queries for tabs without recent heartbeat.
- **Malformed protocol**: Invalid JSON lines from sidecar are logged and skipped. Invalid commands from Rust are logged by sidecar to stderr and skipped.
- **Stderr capture**: Rust spawns a reader thread for sidecar stderr, pipes all output to `logging.rs`.

## Settings

Add to `Settings`:
```typescript
use_agent_sdk: boolean;  // default true, false = PTY fallback for Claude
```

Toggle via settings modal. When false, Claude tabs use `"terminal"` type (existing PTY path).

## Keyboard Shortcuts

- **Ctrl+Shift+H**: Toggle session browser tab (singleton, same pattern as Ctrl+U for usage). Uses Ctrl+Shift to avoid conflict with Ctrl+H (backspace in terminals).

## Migration Strategy

1. Both engines coexist — `"terminal"` (PTY) and `"agent"` (SDK)
2. Claude defaults to `"agent"` when `use_agent_sdk: true` and sidecar is available
3. Gemini always uses `"terminal"`
4. User can toggle in settings to fall back to PTY
5. Future: deprecate PTY for Claude once SDK path is stable

## Out of Scope

- Custom MCP tools (future phase)
- Multi-agent/subagent workflows (future phase)
- Replacing Gemini with any SDK
- Cross-platform support
