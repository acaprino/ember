# Slash Commands & Agent Mentions — Design Spec

**Date**: 2026-03-16
**Status**: Approved

## Goal

Implement Claude Code CLI-like behavior in Figtree's chat UI:
- `/` triggers a unified command menu (local Figtree commands + SDK skills)
- `@` triggers an agent mention menu (SDK agents, not models)

## Architecture

### Data Flow

```
Session start → SDK emits "system" msg with subtype "init"
              → Sidecar calls q.supportedCommands() + q.supportedAgents()
              → Emits {evt:"commands_init", tabId, commands:[], agents:[]}
              → Frontend stores in ChatView state

Every 60s     → Frontend calls refresh_commands Tauri command
              → Rust sends {cmd:"refreshCommands", tabId} to sidecar
              → Sidecar looks up session by tabId, calls q.supportedCommands() + q.supportedAgents()
              → Emits {evt:"commands", tabId, commands:[], agents:[]} (oneshot response pattern)
              → Rust routes via OneshotMap, returns JSON to frontend
```

**Timing**: `supportedCommands()` and `supportedAgents()` are methods on the query object. They are called after the first `system/init` event (session is initialized at that point). Each tab has its own command/agent list since sessions may have different skills loaded.

### Types

```typescript
// From @anthropic-ai/claude-agent-sdk/sdk.d.ts
type SlashCommand = {
  name: string;        // Skill name without leading slash
  description: string;
  argumentHint: string; // e.g. "<file>"
};

type AgentInfo = {
  name: string;        // e.g. "Explore", "general-purpose"
  description: string;
  model?: string;      // Model alias, inherits parent if omitted
};

// Figtree internal — extended Command interface
type Command = {
  name: string;          // e.g. "/clear", "/commit"
  description: string;
  argumentHint?: string; // Only for SDK skills
  source: "local" | "skill";
};
```

### Local Commands (hardcoded in Figtree)

These execute locally in the UI, not sent to the agent:

| Command | Action |
|---------|--------|
| `/clear` | Clear chat messages |
| `/compact` | Send `/compact` to agent (summarize conversation) |
| `/sidebar` | Toggle right sidebar |
| `/theme` | Open settings modal |
| `/sessions` | Open session browser tab |
| `/help` | Show help / keyboard shortcuts |

**Note**: `/compact` and `/help` are kept as local commands that forward to the agent. `/model` and `/effort` are removed — model switching is done via Tab key in project picker, effort via F2. If the SDK returns skills with the same name as a local command, the **local command takes precedence** and the SDK duplicate is hidden.

## Component Changes

### 1. Sidecar Protocol (`sidecar/sidecar.js`)

**New event after init**: In the existing `case "system"` handler, after detecting `subtype === "init"`, call `supportedCommands()` + `supportedAgents()` on the query object and emit:
```json
{"evt": "commands_init", "tabId": "...", "commands": [...], "agents": [...]}
```

**New command handler**: `refreshCommands`
- Looks up the session by `tabId` in the `sessions` Map
- Calls `session.query.supportedCommands()` and `session.query.supportedAgents()`
- Emits response using the **oneshot pattern** (same as `listSessions` / `getMessages`):
```json
{"evt": "commands", "tabId": "...", "commands": [...], "agents": [...]}
```

### 2. Rust Backend (`app/src-tauri/src/sidecar.rs`)

**New `SidecarEvent` fields**:
```rust
// Add to SidecarEvent struct:
#[serde(default)]
commands: Option<serde_json::Value>,
#[serde(default)]
agents: Option<serde_json::Value>,
```

**New `AgentEvent` variant**:
```rust
// Add to AgentEvent enum:
CommandsInit { commands: serde_json::Value, agents: serde_json::Value },
```

**Stdout parser**: Add match arms:
- `"commands_init"` → emit `AgentEvent::CommandsInit` via channel (same as other events)
- `"commands"` → route via `OneshotMap` (same pattern as `"sessions"` / `"messages"`)

**New Tauri command**: `refresh_commands(tab_id: String) -> Result<Value, String>`
- Sends `{"cmd":"refreshCommands","tabId":"..."}` to sidecar
- Registers a oneshot sender, waits for the `"commands"` response
- Returns the JSON `{commands:[], agents:[]}` to frontend

### 3. CommandMenu (`app/src/components/chat/CommandMenu.tsx`)

**Current**: Hardcoded 8 commands, flat list.
**New**:
- Props: `sdkCommands: SlashCommand[]` (from parent, default `[]`)
- Internal: merges local commands (`source: "local"`) + SDK commands (`source: "skill"`)
- **Name collision**: SDK commands whose `name` matches a local command name are filtered out
- Layout with section headers:
  ```
  ── Figtree ──────────────
  /clear       Clear chat messages
  /compact     Summarize conversation
  /sidebar     Toggle right sidebar
  ...
  ── Skills ─────────────
  /commit      Create a git commit
  /review-pr   Review pull request   <file>
  ...
  ```
- Filter searches across both sections; hides section headers when their section is empty
- SDK commands show `argumentHint` in dim text after description
- Keyboard navigation (arrows) skips section header rows
- Selection callback returns `Command` with `source` field
- Max-height with overflow scroll (existing `.command-menu` CSS already handles this)

### 4. MentionMenu (`app/src/components/chat/MentionMenu.tsx`)

**Current**: Shows models from `MODELS` constant. Note: the `@` model switching was already non-functional in ChatView (no `onMention` handler was wired up), so removing models is not a regression.

**New**:
- Props: `agents: AgentInfo[]` (from parent, default `[]`)
- Shows agent types:
  ```
  @Explore          Fast codebase exploration
  @general-purpose  General-purpose agent
  @Plan             Software architect
  ```
- Selection inserts `@AgentName ` into the input text
- The Agent SDK interprets `@AgentName` in the message automatically
- Same keyboard navigation (arrows, Enter, Esc)
- If `agents` is empty, menu does not render

### 5. ChatInput (`app/src/components/chat/ChatInput.tsx`)

- New props: `sdkCommands?: SlashCommand[]`, `sdkAgents?: AgentInfo[]`
- Passes `sdkCommands` to `CommandMenu`
- Passes `sdkAgents` to `MentionMenu`
- Placeholder updated: `"Type a message... (/ for commands, @ for agents)"`
- `onMention` callback removed (was unused in ChatView)

### 6. ChatView (`app/src/components/ChatView.tsx`)

- New state: `sdkCommands: SlashCommand[]` (init `[]`), `sdkAgents: AgentInfo[]` (init `[]`)
- In `handleAgentEvent`: new case for `type === "commandsInit"` → set both states
- **60s refresh interval**: `useEffect` with `setInterval` calling `invoke("refresh_commands", {tabId})`, updates state. Interval is **cleared on unmount** (cleanup function). Errors are silently ignored (keeps last known lists).
- `handleCommand` extended:
  - `source === "local"` → handle locally (clear, compact→sendAgentMessage, sidebar, theme, sessions, help)
  - `source === "skill"` → `sendAgentMessage(tabId, "/" + command.name)`

### 7. CSS (`app/src/components/chat/ChatInput.css`)

- New `.command-section-header` style: dim text, small font, border-bottom, not clickable/hoverable
- `.command-arg-hint` style: dim/italic text for argumentHint display
- No new CSS file needed

## What Does NOT Change

- Terminal.tsx (xterm mode) — menus are chat UI only
- Autocomplete system — stays as-is
- Agent lifecycle (spawn/kill)
- Tab management
- Model selection — remains in tab settings / Tab key cycle (removed from `@` menu which was already non-functional)

## Edge Cases

- **Empty SDK lists**: If SDK returns no commands/agents (session not yet initialized), show only local commands for `/` and hide `@` menu entirely
- **Refresh failure**: If `refreshCommands` fails (agent exited, timeout), silently keep last known lists
- **Long command lists**: Menu scrollable with max-height (existing CSS)
- **Argument passthrough**: When user selects an SDK command and types additional text, the full string (e.g., `/commit -m "fix bug"`) is sent to the agent
- **Name collisions**: Local commands take precedence; SDK commands with matching names are hidden
- **Multiple tabs**: Each tab maintains its own command/agent lists (different sessions may have different skills)
- **StrictMode**: Refresh interval cleanup must handle React 18 StrictMode double-mount (clear interval in cleanup, re-create on mount)
