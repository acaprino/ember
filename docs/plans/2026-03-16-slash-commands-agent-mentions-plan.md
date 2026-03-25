# Slash Commands & Agent Mentions — Implementation Plan

> **For agentic workers:** Use subagent-driven execution (if subagents available) or ai-tooling:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Agent SDK's `supportedCommands()` and `supportedAgents()` into Figtree's chat UI, so `/` shows a unified command menu (local + SDK skills) and `@` shows available agents.

**Architecture:** The sidecar emits commands/agents on session init and responds to a `refreshCommands` request. Rust forwards these via channel events and oneshot responses. The frontend stores them in ChatView state and passes them to the refactored CommandMenu and MentionMenu components.

**Tech Stack:** TypeScript/React (frontend), Rust/Tauri 2 (backend), Node.js sidecar (Agent SDK bridge)

**Spec:** `docs/plans/2026-03-16-slash-commands-agent-mentions-design.md`

---

## Task 1: Sidecar — emit commands/agents on init + refreshCommands handler

**Files:**
- Modify: `sidecar/sidecar.js:275-284` (system/init handler)
- Modify: `sidecar/sidecar.js:622-657` (command switch)

- [ ] **Step 1: Add commands_init emission in system/init handler**

In `consumeQuery()`, inside `case "system"`, after the existing `subtype === "init"` block (line 276-280), fetch and emit commands/agents:

```javascript
case "system": {
  if (msg.subtype === "init") {
    const sid = msg.session_id || msg.data?.session_id || "";
    if (sid) {
      emit({ evt: "status", tabId, status: "init", model: "", sessionId: sid });
    }
    // Fetch available commands and agents from the SDK
    try {
      const [commands, agents] = await Promise.all([
        q.supportedCommands(),
        q.supportedAgents(),
      ]);
      emit({ evt: "commands_init", tabId, commands, agents });
    } catch (err) {
      log(`Failed to fetch commands/agents for ${tabId}:`, err.message);
    }
  } else if (msg.subtype === "status") {
    emit({ evt: "status", tabId, status: msg.status || "idle", model: "" });
  }
  break;
}
```

- [ ] **Step 2: Add refreshCommands command handler**

Add a new `handleRefreshCommands` function after `handleSetModel` (after line 408).

**Important**: The Rust side sends a synthetic `tabId` (e.g., `_commands_{uuid}`) for oneshot routing, plus the real tab ID as `sessionTabId` for session lookup. The sidecar must use `sessionTabId` to find the session but emit the response with the synthetic `tabId` so the oneshot router matches.

```javascript
async function handleRefreshCommands(cmd) {
  const sessionTabId = cmd.sessionTabId || cmd.tabId;
  const session = sessions.get(sessionTabId);
  if (!session?.query) {
    emit({ evt: "commands", tabId: cmd.tabId, commands: [], agents: [] });
    return;
  }
  try {
    const [commands, agents] = await Promise.all([
      session.query.supportedCommands(),
      session.query.supportedAgents(),
    ]);
    emit({ evt: "commands", tabId: cmd.tabId, commands, agents });
  } catch (err) {
    log(`refreshCommands error for ${sessionTabId}:`, err.message);
    emit({ evt: "commands", tabId: cmd.tabId, commands: [], agents: [] });
  }
}
```

- [ ] **Step 3: Register refreshCommands in the command switch**

In the `rl.on("line")` handler's switch block (line 622), add before the `default` case:

```javascript
case "refreshCommands":
  await handleRefreshCommands(cmd);
  break;
```

- [ ] **Step 4: Commit**

```bash
git add sidecar/sidecar.js
git commit -m "feat(sidecar): emit commands/agents on init, add refreshCommands handler"
```

---

## Task 2: Rust Backend — new AgentEvent variant + oneshot routing + Tauri command

**Files:**
- Modify: `app/src-tauri/src/sidecar.rs:19-45` (AgentEvent enum)
- Modify: `app/src-tauri/src/sidecar.rs:50-118` (SidecarEvent struct)
- Modify: `app/src-tauri/src/sidecar.rs:314-369` (stdout parser)
- Modify: `app/src-tauri/src/commands.rs` (add refresh_commands command)
- Modify: `app/src-tauri/src/main.rs:115-143` (invoke_handler)

- [ ] **Step 1: Add CommandsInit variant to AgentEvent**

In `sidecar.rs`, add after `RateLimit` (line 42):

```rust
pub enum AgentEvent {
    // ... existing variants ...
    RateLimit { utilization: f64 },
    CommandsInit { commands: serde_json::Value, agents: serde_json::Value },
    Error { code: String, message: String },
    Exit { code: i32 },
}
```

- [ ] **Step 2: Add commands/agents fields to SidecarEvent**

In `sidecar.rs`, add after the `utilization` field (line 117):

```rust
    // For rate limit events
    #[serde(default)]
    utilization: f64,
    // For commands/agents responses
    #[serde(default)]
    commands: Option<serde_json::Value>,
    #[serde(default)]
    agents: Option<serde_json::Value>,
}
```

- [ ] **Step 3: Add oneshot routing for "commands" event**

In the stdout parser, extend the oneshot check block (line 315). Change:

```rust
if event.evt == "sessions" || event.evt == "messages" {
```

to:

```rust
if event.evt == "sessions" || event.evt == "messages" || event.evt == "commands" {
```

And extend the value extraction:

```rust
if event.evt == "sessions" || event.evt == "messages" || event.evt == "commands" {
    let value = if event.evt == "sessions" {
        event.list.unwrap_or(serde_json::Value::Array(vec![]))
    } else if event.evt == "messages" {
        serde_json::json!({
            "sessionId": event.session_id,
            "messages": event.messages.unwrap_or(serde_json::Value::Array(vec![]))
        })
    } else {
        // commands
        serde_json::json!({
            "commands": event.commands.unwrap_or(serde_json::Value::Array(vec![])),
            "agents": event.agents.unwrap_or(serde_json::Value::Array(vec![]))
        })
    };

    if let Some(sender) = oneshots.lock().unwrap().remove(tab_id) {
        let _ = sender.send(value);
    }
    continue;
}
```

- [ ] **Step 4: Add channel routing for "commands_init" event**

In the `match event.evt.as_str()` block (after `"rateLimit"` handler, around line 354), add:

```rust
"commands_init" => AgentEvent::CommandsInit {
    commands: event.commands.unwrap_or(serde_json::Value::Array(vec![])),
    agents: event.agents.unwrap_or(serde_json::Value::Array(vec![])),
},
```

- [ ] **Step 5: Add refresh_commands Tauri command**

In `commands.rs`, add after `get_agent_messages` (after line 510):

```rust
#[tauri::command]
pub async fn refresh_commands(
    sidecar: State<'_, Arc<SidecarManager>>,
    tab_id: String,
) -> Result<serde_json::Value, String> {
    if !sidecar.available() {
        return Err("Agent SDK not available".to_string());
    }
    let key = format!("_commands_{}", uuid::Uuid::new_v4());
    let rx = sidecar.register_oneshot(&key);
    sidecar.send_command(&serde_json::json!({
        "cmd": "refreshCommands",
        "tabId": key,
        "sessionTabId": tab_id,
    }))?;

    rx.await.map_err(|_| "Sidecar did not respond".to_string())
}
```

- [ ] **Step 6: Register in invoke_handler**

In `main.rs`, add `commands::refresh_commands` to the `invoke_handler` list (after line 141):

```rust
commands::agent_autocomplete,
commands::refresh_commands,
autocomplete::autocomplete_files,
```

- [ ] **Step 7: Build and verify compilation**

Run: `cd app/src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 8: Commit**

```bash
git add app/src-tauri/src/sidecar.rs app/src-tauri/src/commands.rs app/src-tauri/src/main.rs
git commit -m "feat(backend): CommandsInit event, commands oneshot routing, refresh_commands command"
```

---

## Task 3: Frontend Types — add AgentEvent variant + refreshCommands invoke

**Files:**
- Modify: `app/src/types.ts:228-242` (AgentEvent type)
- Modify: `app/src/hooks/useAgentSession.ts` (add refreshCommands function)

- [ ] **Step 1: Add commandsInit to AgentEvent union**

In `types.ts`, add before the `| { type: "error"` line (line 241):

```typescript
export type AgentEvent =
  // ... existing variants ...
  | { type: "rateLimit"; utilization: number }
  | { type: "commandsInit"; commands: SlashCommand[]; agents: AgentInfoSDK[] }
  | { type: "error"; code: string; message: string }
  | { type: "exit"; code: number };
```

- [ ] **Step 2: Add SDK types to types.ts**

Add after the `PermissionSuggestion` interface (after line 226):

```typescript
/** Slash command from Agent SDK (skill invoked via /command syntax). */
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

/** Agent info from Agent SDK (subagent invoked via @agent syntax). */
export interface AgentInfoSDK {
  name: string;
  description: string;
  model?: string;
}
```

- [ ] **Step 3: Add refreshCommands invoke to useAgentSession.ts**

Add after the `requestAutocomplete` function (after line 110):

```typescript
export async function refreshCommands(tabId: string): Promise<{ commands: SlashCommand[]; agents: AgentInfoSDK[] }> {
  return invoke("refresh_commands", { tabId });
}
```

And add the import at the top:

```typescript
import type { AgentEvent, SessionInfo, PermissionSuggestion, SlashCommand, AgentInfoSDK } from "../types";
```

- [ ] **Step 4: Commit**

```bash
git add app/src/types.ts app/src/hooks/useAgentSession.ts
git commit -m "feat(types): add SlashCommand, AgentInfoSDK types and refreshCommands invoke"
```

---

## Task 4: CommandMenu — sectioned layout with local + SDK commands

**Files:**
- Modify: `app/src/components/chat/CommandMenu.tsx` (full rewrite)
- Modify: `app/src/components/chat/ChatInput.css` (add section header + arg hint styles)

- [ ] **Step 1: Rewrite CommandMenu.tsx**

Replace the entire file contents:

```tsx
import { memo, useState, useEffect, useRef } from "react";
import type { SlashCommand } from "../../types";

export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  source: "local" | "skill";
}

const LOCAL_COMMANDS: Command[] = [
  { name: "/clear", description: "Clear chat messages", source: "local" },
  { name: "/compact", description: "Summarize conversation", source: "local" },
  { name: "/sidebar", description: "Toggle right sidebar", source: "local" },
  { name: "/theme", description: "Change theme", source: "local" },
  { name: "/sessions", description: "Browse sessions", source: "local" },
  { name: "/help", description: "Show help", source: "local" },
];

/** Names of local commands, for collision filtering. */
const LOCAL_NAMES = new Set(LOCAL_COMMANDS.map((c) => c.name));

interface Props {
  filter: string;
  sdkCommands?: SlashCommand[];
  onSelect: (command: Command) => void;
  onDismiss: () => void;
}

export default memo(function CommandMenu({ filter, sdkCommands = [], onSelect, onDismiss }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Merge: local commands + SDK commands (filtering collisions)
  const sdkMapped: Command[] = sdkCommands
    .filter((c) => !LOCAL_NAMES.has("/" + c.name))
    .map((c) => ({
      name: "/" + c.name,
      description: c.description,
      argumentHint: c.argumentHint || undefined,
      source: "skill" as const,
    }));

  const lowerFilter = filter.toLowerCase();
  const filteredLocal = LOCAL_COMMANDS.filter(
    (c) => c.name.toLowerCase().includes(lowerFilter) || c.description.toLowerCase().includes(lowerFilter),
  );
  const filteredSdk = sdkMapped.filter(
    (c) => c.name.toLowerCase().includes(lowerFilter) || c.description.toLowerCase().includes(lowerFilter),
  );

  // Build flat selectable list (no headers)
  const selectableItems = [...filteredLocal, ...filteredSdk];

  useEffect(() => { setSelectedIdx(0); }, [filter]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, selectableItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && selectableItems.length > 0) {
        e.preventDefault();
        onSelect(selectableItems[selectedIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectableItems, selectedIdx, onSelect, onDismiss]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".command-item.selected") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (selectableItems.length === 0) return null;

  let globalIdx = 0;

  return (
    <div className="command-menu" ref={listRef}>
      {filteredLocal.length > 0 && (
        <>
          <div className="command-section-header">Figtree</div>
          {filteredLocal.map((cmd) => {
            const idx = globalIdx++;
            return (
              <div
                key={cmd.name}
                className={`command-item${idx === selectedIdx ? " selected" : ""}`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <span className="command-name">{cmd.name}</span>
                <span className="command-desc">{cmd.description}</span>
              </div>
            );
          })}
        </>
      )}
      {filteredSdk.length > 0 && (
        <>
          <div className="command-section-header">Skills</div>
          {filteredSdk.map((cmd) => {
            const idx = globalIdx++;
            return (
              <div
                key={cmd.name}
                className={`command-item${idx === selectedIdx ? " selected" : ""}`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <span className="command-name">{cmd.name}</span>
                <span className="command-desc">
                  {cmd.description}
                  {cmd.argumentHint && <span className="command-arg-hint"> {cmd.argumentHint}</span>}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Add CSS for section headers and argument hints**

Append to `app/src/components/chat/ChatInput.css` (after line 249):

```css
/* ── Command Menu Section Headers ────────────────────────────── */
.command-section-header {
  padding: 4px var(--space-2) 2px;
  font-size: var(--text-xs);
  color: var(--text-dim);
  opacity: 0.4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid color-mix(in srgb, var(--overlay0) 15%, transparent);
  user-select: none;
}

.command-arg-hint {
  color: var(--text-dim);
  opacity: 0.4;
  font-style: italic;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/chat/CommandMenu.tsx app/src/components/chat/ChatInput.css
git commit -m "feat(CommandMenu): sectioned layout with local + SDK commands"
```

---

## Task 5: MentionMenu — show agents instead of models

**Files:**
- Modify: `app/src/components/chat/MentionMenu.tsx` (rewrite)

- [ ] **Step 1: Rewrite MentionMenu.tsx**

Replace the entire file contents:

```tsx
import { memo, useState, useEffect, useRef } from "react";
import type { AgentInfoSDK } from "../../types";

export interface Mention {
  name: string;
  display: string;
}

interface Props {
  filter: string;
  agents?: AgentInfoSDK[];
  onSelect: (mention: Mention) => void;
  onDismiss: () => void;
}

export default memo(function MentionMenu({ filter, agents = [], onSelect, onDismiss }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const options: Mention[] = agents.map((a) => ({
    name: `@${a.name}`,
    display: a.description,
  }));

  const filtered = options.filter(
    (m) => m.name.toLowerCase().includes(filter.toLowerCase()) || m.display.toLowerCase().includes(filter.toLowerCase()),
  );

  useEffect(() => { setSelectedIdx(0); }, [filter]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        onSelect(filtered[selectedIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [filtered, selectedIdx, onSelect, onDismiss]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (filtered.length === 0) return null;

  return (
    <div className="command-menu" ref={listRef}>
      {filtered.map((m, i) => (
        <div
          key={m.name}
          className={`command-item${i === selectedIdx ? " selected" : ""}`}
          onClick={() => onSelect(m)}
          onMouseEnter={() => setSelectedIdx(i)}
        >
          <span className="command-name">{m.name}</span>
          <span className="command-desc">{m.display}</span>
        </div>
      ))}
    </div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/chat/MentionMenu.tsx
git commit -m "feat(MentionMenu): show SDK agents instead of models"
```

---

## Task 6: ChatInput — wire sdkCommands and sdkAgents props

**Files:**
- Modify: `app/src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Update ChatInput props and pass-through**

Changes to `ChatInput.tsx`:

1. Add imports for `SlashCommand` and `AgentInfoSDK` from `../../types`
2. Add props `sdkCommands?: SlashCommand[]` and `sdkAgents?: AgentInfoSDK[]`
3. Remove `onMention` prop (unused in ChatView)
4. Pass `sdkCommands` to `CommandMenu`
5. Pass `agents` to `MentionMenu`
6. Update placeholder text

Updated props interface:

```typescript
import type { Attachment, SlashCommand, AgentInfoSDK } from "../../types";

interface Props {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onCommand?: (command: Command) => void;
  disabled: boolean;
  processing: boolean;
  isActive: boolean;
  inputStyle?: "chat" | "terminal";
  sdkCommands?: SlashCommand[];
  sdkAgents?: AgentInfoSDK[];
  droppedFiles?: string[];
  onDroppedFilesConsumed?: () => void;
}
```

Update the component signature to remove `onMention` and add new props:

```typescript
export default memo(function ChatInput({ onSubmit, onCommand, disabled, processing, isActive, inputStyle = "chat", sdkCommands, sdkAgents, droppedFiles, onDroppedFilesConsumed }: Props) {
```

Remove `handleMentionSelect`'s call to `onMention`:

```typescript
const handleMentionSelect = (mention: Mention) => {
  setShowMentionMenu(false);
  const atIdx = text.lastIndexOf("@");
  const before = text.slice(0, atIdx);
  setText(before + mention.name + " ");
  textareaRef.current?.focus();
};
```

Update CommandMenu render:

```tsx
<CommandMenu
  filter={menuFilter}
  sdkCommands={sdkCommands}
  onSelect={handleCommandSelect}
  onDismiss={() => { setShowCommandMenu(false); setText(""); }}
/>
```

Update MentionMenu render:

```tsx
<MentionMenu
  filter={menuFilter}
  agents={sdkAgents}
  onSelect={handleMentionSelect}
  onDismiss={() => setShowMentionMenu(false)}
/>
```

Update placeholder:

```tsx
placeholder="Type a message... (/ for commands, @ for agents)"
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/chat/ChatInput.tsx
git commit -m "feat(ChatInput): wire sdkCommands and sdkAgents props"
```

---

## Task 7: ChatView — store commands/agents state, refresh interval, handle commands

**Files:**
- Modify: `app/src/components/ChatView.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `ChatView.tsx`, add imports:

```typescript
import { refreshCommands } from "../hooks/useAgentSession";
import type { SlashCommand, AgentInfoSDK } from "../types";
```

Inside the component, add state (after line 50, the existing state declarations):

```typescript
const [sdkCommands, setSdkCommands] = useState<SlashCommand[]>([]);
const [sdkAgents, setSdkAgents] = useState<AgentInfoSDK[]>([]);
```

- [ ] **Step 2: Handle commandsInit in handleAgentEvent**

In the `handleAgentEvent` function, add a new case after the `rateLimit` handler (around line 237):

```typescript
} else if (event.type === "commandsInit") {
  setSdkCommands(event.commands);
  setSdkAgents(event.agents);
}
```

- [ ] **Step 3: Add 60s refresh interval (triggered after agent starts)**

The refresh interval cannot be set up in a standalone `useEffect` with `[tabId]` because `agentStartedRef.current` is false at mount time and the effect never re-runs. Instead, start the interval inside the agent lifecycle effect, after the agent has been confirmed started.

In the existing agent lifecycle `useEffect` (around line 257), after `agentStartedRef.current = true;`, add interval setup:

```typescript
.then(() => {
  if (cancelled) return;
  agentStartedRef.current = true;
  onSessionCreatedRef.current(tabIdRef.current, tabId);

  // Start periodic refresh of commands/agents (every 60s)
  refreshIntervalRef.current = setInterval(() => {
    refreshCommands(tabId).then((data) => {
      setSdkCommands(data.commands || []);
      setSdkAgents(data.agents || []);
    }).catch(() => {
      // Keep last known lists on failure
    });
  }, 60_000);
})
```

Add a ref at the top of the component (near other refs):

```typescript
const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

In the cleanup return of the same effect, clear the interval:

```typescript
return () => {
  cancelled = true;
  if (refreshIntervalRef.current) {
    clearInterval(refreshIntervalRef.current);
    refreshIntervalRef.current = null;
  }
  // ... existing deferred kill logic ...
};
```

- [ ] **Step 4: Extend handleCommand for all local commands + SDK routing**

Replace the existing `handleCommand` function (lines 337-348):

```typescript
const handleCommand = (command: Command) => {
  if (command.source === "skill") {
    // SDK skill — send as slash command text to agent
    sendAgentMessage(tabId, command.name).catch(console.error);
    setInputState("processing");
    return;
  }
  // Local commands
  switch (command.name) {
    case "/clear":
      setMessages([]);
      break;
    case "/sidebar":
      setSidebarOpen((prev) => !prev);
      break;
    case "/compact":
    case "/help":
      sendAgentMessage(tabId, command.name).catch(console.error);
      setInputState("processing");
      break;
    case "/theme":
      // Theme is handled via Ctrl+, in App.tsx — emit a custom event
      window.dispatchEvent(new CustomEvent("figtree:open-settings"));
      break;
    case "/sessions":
      window.dispatchEvent(new CustomEvent("figtree:open-sessions"));
      break;
  }
};
```

- [ ] **Step 5: Pass sdkCommands and sdkAgents to all ChatInput instances**

Update all `<ChatInput>` renders in ChatView to include the new props. There are 3 instances (terminal mode, chat mode, processing state). The floating mini-input is not a ChatInput. Add to each:

```tsx
sdkCommands={sdkCommands}
sdkAgents={sdkAgents}
```

For example, the terminal-mode input (around line 421):

```tsx
<ChatInput
  onSubmit={handleSubmit}
  onCommand={handleCommand}
  disabled={false}
  processing={false}
  isActive={isActive}
  inputStyle="terminal"
  sdkCommands={sdkCommands}
  sdkAgents={sdkAgents}
  droppedFiles={droppedFiles}
  onDroppedFilesConsumed={() => setDroppedFiles([])}
/>
```

Apply the same pattern to the other 3 ChatInput instances (chat mode, processing state, and floating mini-input if applicable).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ChatView.tsx
git commit -m "feat(ChatView): store SDK commands/agents, 60s refresh, extended command handling"
```

---

## Task 8: Verify full build + manual test

- [ ] **Step 1: Run full Rust build**

Run: `cd app && cargo tauri build --debug` (or `cargo tauri dev`)
Expected: Compiles and launches without errors.

- [ ] **Step 2: Manual test — slash commands**

1. Open Figtree, launch a project tab
2. Wait for session to initialize (agent starts)
3. Type `/` in the input
4. Expected: Menu appears with "Figtree" section (clear, compact, sidebar, theme, sessions, help) and "Skills" section (SDK commands from Agent SDK)
5. Type `/com` — both sections should filter
6. Select `/clear` — messages should clear
7. Select an SDK skill (e.g., `/commit`) — text should be sent to agent

- [ ] **Step 3: Manual test — agent mentions**

1. In an active session, type `@` in the input
2. Expected: Menu appears with available agents (Explore, general-purpose, etc.)
3. Select an agent — `@AgentName ` should be inserted into input
4. Type a message after it and send — agent should process it

- [ ] **Step 4: Manual test — refresh**

1. Wait 60+ seconds with a session open
2. Check console logs for refresh_commands calls
3. If new skills were loaded (unlikely in test), they should appear

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
