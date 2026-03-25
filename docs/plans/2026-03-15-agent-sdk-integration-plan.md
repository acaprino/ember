# Agent SDK Integration — Implementation Plan

> **For agentic workers:** Use subagent-driven execution (if subagents available) or ai-tooling:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate claude-agent-sdk via Node.js sidecar to replace PTY for Claude tabs, add session browser, and enhance usage tab.

**Architecture:** Node.js sidecar communicates with Rust backend via JSON-lines over stdin/stdout. Frontend renders structured SDK events as ANSI in xterm.js. Session browser and enhanced usage use SDK data.

**Tech Stack:** @anthropic-ai/claude-agent-sdk, Node.js, Rust/Tauri 2, React 19, TypeScript, xterm.js

---

## Chunk 1: Sidecar Foundation

### Task 1: Create Node.js sidecar package

**Files:**
- Create: `sidecar/package.json`
- Create: `sidecar/sidecar.js`

- [ ] **Step 1: Create sidecar directory and package.json**

```bash
cd D:/Projects/figtree
mkdir -p sidecar
```

```json
// sidecar/package.json
{
  "name": "figtree-sidecar",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "sidecar.js",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  }
}
```

- [ ] **Step 2: Create sidecar.js — JSON-line protocol handler**

The sidecar reads JSON-line commands from stdin, manages SDK sessions, and writes JSON-line events to stdout. Key responsibilities:
- Parse commands: `create`, `send`, `resume`, `fork`, `kill`, `list_sessions`, `get_messages`, `set_model`, `permission_response`
- Maintain a `Map<tabId, { query, inputResolve }>` for active sessions
- For each SDK session, iterate the `AsyncGenerator` and emit events to stdout
- Use streaming input mode (`AsyncIterable`) for `send` — resolve a pending promise when user sends input
- Emit all events with `tabId` for multiplexing
- Log errors to stderr

- [ ] **Step 3: Install dependencies**

```bash
cd D:/Projects/figtree/sidecar && npm install
```

- [ ] **Step 4: Test sidecar manually**

```bash
echo '{"cmd":"list_sessions","tabId":"_control","cwd":"D:/Projects/figtree"}' | node sidecar/sidecar.js
```

Verify it outputs a JSON-line with `{"evt":"sessions","tabId":"_control","list":[...]}` and exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add sidecar/
git commit -m "feat: add Node.js sidecar for claude-agent-sdk integration"
```

---

### Task 2: Rust SidecarManager

**Files:**
- Create: `app/src-tauri/src/sidecar.rs`
- Modify: `app/src-tauri/src/main.rs`
- Modify: `app/src-tauri/src/commands.rs`

- [ ] **Step 1: Create sidecar.rs with SidecarManager struct**

Implement:
- `SidecarManager::new()` — find `node.exe` on PATH (via `which`), spawn `node sidecar/sidecar.js`, set up stdin/stdout/stderr pipes
- `SidecarManager::send_command(cmd: serde_json::Value)` — write JSON-line to stdin
- `SidecarManager::start_reader(channels)` — spawn thread reading stdout JSON-lines, routing events by `tabId` to the correct `Channel<AgentEvent>`
- `SidecarManager::start_stderr_reader()` — spawn thread reading stderr, logging via `log_info!`
- `AgentEvent` enum with all variants (serde tagged)
- `SidecarManager::available()` — returns false if Node.js not found

- [ ] **Step 2: Register SidecarManager in main.rs**

Add `SidecarManager` as Tauri managed state. Initialize on app setup (before `.run()`). If Node.js not found, create a dummy unavailable manager.

- [ ] **Step 3: Add Tauri commands for agent sessions in commands.rs**

New commands:
- `spawn_agent(projectPath, model, effort, systemPrompt, skipPerms, onEvent: Channel<AgentEvent>)` — register channel, send `create` to sidecar
- `agent_send(tabId, text)` — send `send` command to sidecar
- `agent_resume(tabId, sessionId, onEvent)` — register channel, send `resume`
- `agent_fork(tabId, sessionId, onEvent)` — register channel, send `fork`
- `agent_kill(tabId)` — send `kill`, remove channel
- `agent_permission(tabId, allow)` — send `permission_response`
- `agent_set_model(tabId, model)` — send `set_model`
- `list_agent_sessions(cwd)` — send `list_sessions`, wait for response (oneshot channel)
- `get_agent_messages(sessionId)` — send `get_messages`, wait for response

- [ ] **Step 4: Register new commands in main.rs invoke_handler**

Add all new commands to the `.invoke_handler(tauri::generate_handler![...])`.

- [ ] **Step 5: Build and verify compilation**

```bash
cd D:/Projects/figtree/app && cargo build
```

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/sidecar.rs app/src-tauri/src/main.rs app/src-tauri/src/commands.rs
git commit -m "feat: add Rust SidecarManager for agent-sdk communication"
```

---

## Chunk 2: Frontend Agent Engine

### Task 3: TypeScript types and useAgentSession hook

**Files:**
- Modify: `app/src/types.ts`
- Create: `app/src/hooks/useAgentSession.ts`

- [ ] **Step 1: Extend Tab type in types.ts**

Add `"agent"` and `"sessions"` to the Tab type union. Add `agentSessionId?: string` field for SDK session tracking.

- [ ] **Step 2: Add AgentEvent type in types.ts**

```typescript
export type AgentEvent =
  | { type: "assistant"; text: string; streaming: boolean }
  | { type: "toolUse"; tool: string; input: any }
  | { type: "toolResult"; tool: string; output: string; success: boolean }
  | { type: "permission"; tool: string; description: string }
  | { type: "inputRequired" }
  | { type: "thinking"; text: string }
  | { type: "status"; status: string; model: string }
  | { type: "progress"; message: string }
  | { type: "result"; cost: number; inputTokens: number; outputTokens: number; turns: number; durationMs: number }
  | { type: "error"; code: string; message: string }
  | { type: "exit"; code: number };
```

- [ ] **Step 3: Add Settings field**

Add `use_agent_sdk: boolean` (default `true`) to `Settings` interface.

- [ ] **Step 4: Create useAgentSession.ts hook**

Mirror `usePty.ts` pattern:
- `spawnAgent(projectPath, model, effort, systemPrompt, skipPerms, onEvent, onExit)` → calls `invoke("spawn_agent", ...)` with Tauri Channel
- `sendAgentMessage(tabId, text)` → calls `invoke("agent_send", ...)`
- `resumeAgent(tabId, sessionId, onEvent, onExit)` → calls `invoke("agent_resume", ...)`
- `forkAgent(tabId, sessionId, onEvent, onExit)` → calls `invoke("agent_fork", ...)`
- `killAgent(tabId)` → calls `invoke("agent_kill", ...)`
- `respondPermission(tabId, allow)` → calls `invoke("agent_permission", ...)`
- `listSessions(cwd)` → calls `invoke("list_agent_sessions", ...)`
- `getSessionMessages(sessionId)` → calls `invoke("get_agent_messages", ...)`

- [ ] **Step 5: Commit**

```bash
git add app/src/types.ts app/src/hooks/useAgentSession.ts
git commit -m "feat: add AgentEvent types and useAgentSession hook"
```

---

### Task 4: ANSI Renderer

**Files:**
- Create: `app/src/ansiRenderer.ts`

- [ ] **Step 1: Create ansiRenderer.ts**

Pure functions that convert `AgentEvent` to ANSI strings:

```typescript
export function renderAgentEvent(event: AgentEvent, theme: ThemeColors, cols: number): string
```

Dispatches to specific renderers based on event type:
- `assistant` → white text, word-wrapped to `cols`
- `toolUse` → accent-colored box: `╭─ Tool: name ─╮\n│ content │\n╰──────────╯`
- `toolResult` → green `✓ tool` or red `✗ tool: error`
- `permission` → yellow `⚠ Allow {tool}: {description}? [Y/n]`
- `inputRequired` → accent-colored prompt `❯ `
- `thinking` → dim italic `⠋ Thinking...`
- `status` → dim `[model] status`
- `result` → dim horizontal rule `── $0.02 │ 1.5K tokens │ 3 turns │ 12s ──`
- `error` → red block with message
- `exit` → dim `Session ended (code N)`

Use `\x1b[...m` ANSI codes. Colors come from `ThemeColors` (convert hex to RGB for ANSI `38;2;r;g;b`).

- [ ] **Step 2: Commit**

```bash
git add app/src/ansiRenderer.ts
git commit -m "feat: add ANSI renderer for agent SDK events"
```

---

### Task 5: Terminal.tsx agent mode integration

**Files:**
- Modify: `app/src/components/Terminal.tsx`

- [ ] **Step 1: Add agent mode branching**

In Terminal.tsx, check `tab.type`:
- If `"agent"`: use `spawnAgent` instead of `spawnClaude`, skip banner detection, skip PTY resize
- Write Figtree logo directly to xterm via `terminal.write(ANSI_LOGO)`
- On events: call `renderAgentEvent()` and write to xterm

- [ ] **Step 2: Implement input state machine**

Add state ref: `inputState: "idle" | "awaiting_input" | "processing" | "awaiting_permission"`

In `terminal.onData()` handler for agent tabs:
- `awaiting_input`: buffer keystrokes, echo to xterm, on Enter → `sendAgentMessage()`, transition to `processing`
- `awaiting_permission`: accept only Y/y/N/n/Enter → `respondPermission()`, transition to `processing`
- `processing`: Ctrl+C → interrupt (kill + re-create or SDK interrupt)
- Handle backspace (delete last char from buffer, write `\b \b` to xterm)
- Handle arrow keys for basic line editing

- [ ] **Step 3: Handle agent events in Terminal**

Add event handler for agent Channel messages:
```typescript
onAgentEvent(event: AgentEvent) {
  if (event.type === "inputRequired") {
    inputState = "awaiting_input";
  } else if (event.type === "permission") {
    inputState = "awaiting_permission";
  } else if (event.type === "result") {
    // accumulate for usage tracking
  } else if (event.type === "exit") {
    // update tab exitCode
  }
  terminal.write(renderAgentEvent(event, theme, cols));
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/Terminal.tsx
git commit -m "feat: integrate agent SDK mode in Terminal.tsx"
```

---

## Chunk 3: Session Browser & Usage

### Task 6: Session Browser component

**Files:**
- Create: `app/src/components/SessionBrowser.tsx`
- Modify: `app/src/hooks/useTabManager.ts`
- Modify: `app/src/components/App.tsx` (or wherever tabs render)

- [ ] **Step 1: Create SessionBrowser.tsx**

Follow `NewTabPage.tsx` pattern:
- Fetch sessions via `listSessions()` on mount / when active
- State: `sessions[]`, `selectedIdx`, `filter`, `sortBy`
- Keyboard: arrows to navigate, type to filter, Enter to view, R to resume, F to fork, Esc to close
- Render using `Banner`, `Box`, `Sep` from `GsdPrimitives` (ASCII style)
- Display: date, project name, model, cost per session

- [ ] **Step 2: Add toggleSessionsTab to useTabManager**

Add `"sessions"` to singleton tab toggle pattern (same as `toggleUsageTab`).
Add `toggleSessionsTab` callback.

- [ ] **Step 3: Wire Ctrl+Shift+H shortcut**

In the global keyboard handler (App.tsx or wherever shortcuts are), add:
```typescript
if (e.ctrlKey && e.shiftKey && e.key === "H") {
  toggleSessionsTab();
}
```

- [ ] **Step 4: Render SessionBrowser in tab content area**

In the tab rendering logic, add case for `type === "sessions"` → render `<SessionBrowser />`.

- [ ] **Step 5: Implement view/resume/fork actions**

- **Enter (view)**: call `getSessionMessages(sessionId)`, open a new agent tab in read-only mode, render messages via ansiRenderer
- **R (resume)**: open new agent tab with `type: "agent"`, call `resumeAgent(tabId, sessionId, ...)`
- **F (fork)**: open new agent tab with `type: "agent"`, call `forkAgent(tabId, sessionId, ...)`

- [ ] **Step 6: Commit**

```bash
git add app/src/components/SessionBrowser.tsx app/src/hooks/useTabManager.ts
git commit -m "feat: add session browser with list/resume/fork"
```

---

### Task 7: Enhanced Usage Tab

**Files:**
- Modify: `app/src/components/UsagePage.tsx`
- Modify: `app/src-tauri/src/usage_stats.rs`
- Modify: `app/src-tauri/src/commands.rs`

- [ ] **Step 1: Add "By Project" aggregation in usage_stats.rs**

Add `ProjectStats` struct and `project_map` accumulator (keyed by project path extracted from JSONL file path). Add `projects: Vec<ProjectStats>` to `TokenUsageStats`.

- [ ] **Step 2: Add avg_cost_per_session to TotalStats**

Compute `totals.cost / totals.sessions` (or 0.0 if no sessions).

- [ ] **Step 3: Update UsagePage.tsx — By Project section**

Add `buildProjectsTable(projects)` function (same pattern as `buildModelsTable`). Render between "By Model" and "Last 7 Days".

- [ ] **Step 4: Add live session indicator**

Accept a `liveSessionCosts` prop (from parent, accumulated from agent `Result` events). Render at bottom:
```
● Live: figtree/sonnet — $0.02 (1.2K tokens)
```

- [ ] **Step 5: Add Avg/session to totals**

Add line in `buildTotalsBox`: `Avg/Session     $0.20`

- [ ] **Step 6: Commit**

```bash
git add app/src/components/UsagePage.tsx app/src-tauri/src/usage_stats.rs app/src-tauri/src/commands.rs
git commit -m "feat: enhance usage tab with project breakdown and live indicator"
```

---

## Chunk 4: Integration & Polish

### Task 8: Settings integration

**Files:**
- Modify: `app/src-tauri/src/projects.rs` (Settings struct)
- Modify: `app/src/components/SettingsModal.tsx`
- Modify: `app/src/components/NewTabPage.tsx`

- [ ] **Step 1: Add use_agent_sdk field to Rust Settings**

In `projects.rs`, add `use_agent_sdk: Option<bool>` with default `true` to the Settings struct. Handle deserialization of old settings files (missing field = true).

- [ ] **Step 2: Add toggle in SettingsModal**

Add "Agent SDK" toggle in the behavior section of settings. Label: "Use Agent SDK for Claude (requires Node.js)".

- [ ] **Step 3: Use setting in NewTabPage launch logic**

When launching a Claude tab:
- If `use_agent_sdk && sidecarAvailable` → create tab with `type: "agent"`
- Else → create tab with `type: "terminal"` (existing PTY path)

Check sidecar availability via a new `invoke("sidecar_available")` command.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/projects.rs app/src/components/SettingsModal.tsx app/src/components/NewTabPage.tsx
git commit -m "feat: add Agent SDK toggle in settings with PTY fallback"
```

---

### Task 9: Tab bar and status updates

**Files:**
- Modify: `app/src/components/TabBar.tsx`
- Modify: `app/src/components/InfoStrip.tsx` (if exists)

- [ ] **Step 1: Show agent mode indicator in tab label**

For `type: "agent"` tabs, show project name + model (same as terminal tabs). Optionally add a small indicator (e.g., `⚡` prefix) to distinguish from PTY tabs during migration.

- [ ] **Step 2: Status bar warning when sidecar unavailable**

If sidecar is not available (Node.js not found), show a dim warning in the info strip or status area.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/TabBar.tsx
git commit -m "feat: update tab bar for agent mode tabs"
```

---

### Task 10: Build configuration and bundling

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `build_tauri.bat`

- [ ] **Step 1: Add sidecar to Tauri bundle resources**

In `tauri.conf.json`, add `sidecar/` to `bundle.resources` so it's included in the built app.

- [ ] **Step 2: Update build script**

In `build_tauri.bat`, add step to run `npm install --production` in `sidecar/` before building.

- [ ] **Step 3: Verify full build**

```bash
cd D:/Projects/figtree && build_tauri.bat
```

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/tauri.conf.json build_tauri.bat
git commit -m "feat: bundle sidecar in Tauri build"
```

---

### Task 11: Manual testing & smoke test

- [ ] **Step 1: Test agent tab creation**

Launch Figtree, select a project, verify a Claude agent tab opens and shows the Figtree logo + prompt.

- [ ] **Step 2: Test basic conversation**

Type a message, verify streaming response renders in ANSI, verify prompt returns after response.

- [ ] **Step 3: Test session browser**

Press Ctrl+Shift+H, verify session list loads, navigate with arrows, press Enter to view transcript.

- [ ] **Step 4: Test resume and fork**

In session browser, press R on a session — verify it opens in a new agent tab with context. Press F — verify fork creates new session.

- [ ] **Step 5: Test usage tab**

Press Ctrl+U, verify "By Project" section appears, verify live indicator shows active sessions.

- [ ] **Step 6: Test PTY fallback**

In settings, disable "Agent SDK". Launch Claude tab — verify it uses PTY mode (existing behavior).

- [ ] **Step 7: Test Gemini unchanged**

Switch to Gemini tool, launch a tab — verify it still uses PTY mode.
