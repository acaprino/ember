# Claude Code: Context Management, Commands, Memory, Keybindings, and History

Deep analysis of the Claude Code source at `C:\Users\alfio\Downloads\aaa\src\`.
All file references are relative to that root unless stated otherwise.

---

## Context Window Management

### System and User Context (context.ts)

Two memoized async functions build the context that prefixes every conversation:

**`getSystemContext()`** (context.ts:116-150)
- Returns a `{ [k: string]: string }` dictionary
- Includes `gitStatus`: branch, main branch, git user, short status (truncated at 2000 chars), last 5 commits
- Git status is a snapshot taken once at conversation start and not updated
- Includes an optional `cacheBreaker` field for debugging (ant-only feature)
- Skipped in remote mode or when git instructions are disabled

**`getUserContext()`** (context.ts:155-189)
- Returns a `{ [k: string]: string }` dictionary
- Includes `claudeMd`: aggregated CLAUDE.md content from project hierarchy (walks cwd up to home/git-root)
- Includes `currentDate`: today's date string
- CLAUDE.md loading is disabled when `CLAUDE_CODE_DISABLE_CLAUDE_MDS` env var is set or in `--bare` mode
- Memory files (MEMORY.md content) are filtered into the claudeMd aggregation via `getMemoryFiles()`

Both caches are cleared on compaction (`getUserContext.cache.clear()`) so post-compact turns pick up fresh CLAUDE.md/memory content.

### Context Window Size (utils/context.ts:51-98)

```
getContextWindowForModel(model, betas?)
```

Resolution order:
1. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` env var (ant-only override)
2. `[1m]` suffix in model name -> 1,000,000 tokens
3. Model capability registry (`getModelCapability`) if `max_input_tokens >= 100_000`
4. `CONTEXT_1M_BETA_HEADER` beta + model supports 1M -> 1,000,000
5. Default: `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`

Constants:
- `COMPACT_MAX_OUTPUT_TOKENS = 20_000`
- `MAX_OUTPUT_TOKENS_DEFAULT = 32_000`
- `CAPPED_DEFAULT_MAX_TOKENS = 8_000` (slot reservation optimization)
- `ESCALATED_MAX_TOKENS = 64_000` (retry escalation)

### Token Counting (utils/tokens.ts:226-261)

**`tokenCountWithEstimation(messages)`** - hybrid approach:
1. Walks messages backward looking for the last assistant message with API `usage` data
2. If found: uses the API-reported `input_tokens` from that response, plus rough estimation for messages after it
3. If no usage data: falls back to `roughTokenCountEstimationForMessages()` for all messages

The rough estimation (services/tokenEstimation.ts) uses a character-based heuristic: `Math.ceil(text.length * (4/3))` with type-specific handling for thinking blocks, tool_use, images (flat 2000 tokens each), etc.

### Auto-Compact Thresholds (services/compact/autoCompact.ts)

```
effectiveContextWindow = contextWindowForModel - min(maxOutputForModel, 20_000)
autoCompactThreshold  = effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS (13_000)
warningThreshold      = threshold - WARNING_THRESHOLD_BUFFER_TOKENS (20_000)
blockingLimit         = effectiveContextWindow - MANUAL_COMPACT_BUFFER_TOKENS (3_000)
```

For a 200K model: effective = ~180K, auto-compact fires at ~167K tokens.

Auto-compact is disabled when:
- `DISABLE_COMPACT` or `DISABLE_AUTO_COMPACT` env vars are set
- User setting `autoCompactEnabled: false`
- Context-collapse system is active (experimental, takes precedence)
- Reactive-only mode is active (ant-only experiment)
- Query source is `session_memory` or `compact` (recursion guard)
- Circuit breaker: 3 consecutive failures stops further attempts

### Compaction Triggers

**Proactive (auto)**: checked in `shouldAutoCompact()` (autoCompact.ts:160-239) after every agent turn. Compares `tokenCountWithEstimation(messages)` against the auto-compact threshold.

**Manual**: user types `/compact [optional instructions]`.

**Reactive**: on `prompt_too_long` API error, reactive compact fires as a fallback (ant-only experiment, services/compact/reactiveCompact.ts).

---

## Compaction Strategies

There are 5 distinct compaction strategies, tried in priority order:

### Strategy 1: Session Memory Compaction (sessionMemoryCompact.ts)

**When**: tried first on both auto-compact and manual `/compact` (without custom instructions).

**How it works**:
- A background "session memory" agent runs alongside the main conversation, extracting key facts into a structured session memory file
- On compaction, reads the existing session memory content (maintained by a separate extraction process)
- Keeps recent messages after `lastSummarizedMessageId` (the point where session memory was last synced)
- Expands backward to meet minimums: at least 10,000 tokens and 5 messages with text blocks (configurable via remote config)
- Hard cap at 40,000 tokens of preserved messages
- No API call needed for summarization -- uses the pre-built session memory as the summary

**Preserved messages**: adjusts start index to never split tool_use/tool_result pairs or thinking blocks that share the same `message.id` (adjustIndexToPreserveAPIInvariants, sessionMemoryCompact.ts:232-314).

**Falls back** to legacy compact if: session memory is empty/template-only, the summarized message ID is missing, or post-compact tokens exceed the threshold.

### Strategy 2: Reactive Compact (reactiveCompact.ts, ant-only)

**When**: on `prompt_too_long` API error, or when reactive-only mode routes `/compact` through this path.

**How it works**:
- Groups messages by API round (grouping.ts:22-63) -- each group = one assistant response cycle
- Peels groups from the tail of summarizable messages, summarizing in chunks
- Uses partial compact prompts scoped to specific message ranges
- Can preserve both a prefix (cached) and suffix (recent) while summarizing the middle

### Strategy 3: Traditional Full Compaction (compact.ts:387-763)

**When**: fallback when session memory compaction returns null.

**How it works**:
1. Runs `microcompactMessages()` first to reduce token count before summarization
2. Executes PreCompact hooks (user-defined shell scripts)
3. Forks a summarizer agent using `runForkedAgent()` with cache-safe parameters (reuses the parent's prompt cache for cost savings)
4. Sends the full conversation + a detailed summarization prompt
5. Summary is structured: Primary Request, Key Technical Concepts, Files and Code, Errors/Fixes, Problem Solving, All User Messages, Pending Tasks, Current Work, Optional Next Step
6. Strips `<analysis>` scratchpad, keeps `<summary>` content
7. Post-compact: restores top-5 recently-read files as attachments, re-injects plan, skill content, deferred tools, MCP instructions
8. Executes SessionStart and PostCompact hooks

On `prompt_too_long` during compaction itself: truncates oldest API-round groups and retries (up to 3 times) via `truncateHeadForPTLRetry()` (compact.ts:243-291).

### Strategy 4: Microcompact -- Cached (microCompact.ts:305-399)

**When**: before every API call on the main thread (runs before auto-compact check).

**How it works**:
- Tracks tool_result blocks by ID as they accumulate
- When count exceeds a threshold, creates `cache_edits` blocks that delete old tool results from the server-side cache
- Does NOT modify local message content -- purely server-side cache editing
- Only targets specific tool types: FileRead, Shell tools, Grep, Glob, WebSearch, WebFetch, FileEdit, FileWrite
- Keeps the N most recent tool results intact

### Strategy 5: Microcompact -- Time-Based (microCompact.ts:412-530)

**When**: gap since last assistant message exceeds a threshold (server cache has expired).

**How it works**:
- Detects cold cache (long idle gap between messages)
- Content-clears old tool_result blocks in-place (replaces with `[Old tool result content cleared]`)
- Keeps the most recent N tool results
- Mutates message content directly (unlike cached MC which uses API-side cache_edits)
- Takes priority over cached MC when triggered (cache is cold anyway)

### Post-Compact Restoration (compact.ts:520-586)

After any compaction:
- Top 5 most-recently-read files re-attached (budget: 5K tokens per file, 50K total)
- Active plan re-attached if in plan mode
- Invoked skills re-injected (budget: 5K per skill, 25K total)
- Deferred tools, agent listings, MCP instructions re-announced
- SessionStart hooks re-run
- Transcript path included in summary for full-context retrieval
- Compact boundary marker created with metadata (pre-compact token count, preserved tool discovery state)

---

## Command System

### Command Types (types/command.ts)

Three command types:
1. **`local`**: runs locally, returns `{ type: 'text', value }` or `{ type: 'compact', compactionResult }` or `{ type: 'skip' }`. Lazy-loaded via `load()`.
2. **`local-jsx`**: renders Ink/React UI. Lazy-loaded via `load()`.
3. **`prompt`**: expands to content blocks sent to the model. Has `getPromptForCommand()`.

Key fields on `CommandBase` (types/command.ts:175-199):
- `name`, `aliases`, `description`, `argumentHint`
- `isEnabled()`: conditional enablement (feature flags, env vars)
- `isHidden`: hidden from typeahead/help
- `availability`: auth/provider gating (`'claude-ai'` | `'console'`)
- `disableModelInvocation`: whether the model can invoke this
- `whenToUse`: detailed usage scenarios for model-invocable skills
- `loadedFrom`: `'commands_DEPRECATED'` | `'skills'` | `'plugin'` | `'managed'` | `'bundled'` | `'mcp'`
- `kind`: `'workflow'` for workflow-backed commands
- `immediate`: bypasses the command queue

### Registration and Discovery (commands.ts)

**Built-in commands** are imported statically and collected in the `COMMANDS()` memoized function (commands.ts:258-346). Feature-gated commands use conditional `require()`.

**External command sources** loaded in parallel via `loadAllCommands()` (commands.ts:449-469):
1. Bundled skills (`getBundledSkills()`)
2. Built-in plugin skills (`getBuiltinPluginSkillCommands()`)
3. Skill directory commands (`getSkillDirCommands(cwd)`) -- from `.claude/skills/` dirs
4. Workflow commands (`getWorkflowCommands(cwd)`) -- workflow scripts
5. Plugin commands (`getPluginCommands()`)
6. Plugin skills (`getPluginSkills()`)
7. Dynamic skills discovered during file operations (`getDynamicSkills()`)

**Filtering** (commands.ts:476-517):
- `meetsAvailabilityRequirement()` checks auth type
- `isCommandEnabled()` checks `isEnabled()` callback
- Dynamic skills deduped against base commands
- MCP skills filtered separately via `getMcpSkillCommands()`

**Command lookup**: `findCommand()` matches by `name`, `getCommandName()` (prefixed), or `aliases`.

### Execution Flow

1. User types `/commandname args`
2. `findCommand()` resolves the command object
3. For `local` commands: `command.load()` -> `module.call(args, context)`
4. For `local-jsx` commands: `command.load()` -> `module.call(onDone, context, args)` -- renders React UI
5. For `prompt` commands: `command.getPromptForCommand(args, context)` -> content blocks injected into conversation
6. Result handled by the REPL: `text` displayed, `compact` triggers message replacement, `skip` is silent

### Full Command List

**Core built-in commands** (always available):

| Command | Type | Description |
|---------|------|-------------|
| `/add-dir` | local-jsx | Add additional working directories |
| `/agents` | local-jsx | List and select custom agent definitions |
| `/branch` | local | Create a new git branch |
| `/btw` | prompt | Quick note to the model |
| `/chrome` | local | Open Chrome DevTools |
| `/clear` | local | Clear conversation |
| `/color` | local-jsx | Change agent color |
| `/compact` | local | Compact conversation with optional custom instructions |
| `/config` | local-jsx | Open settings panel |
| `/context` | local-jsx | Show context window usage |
| `/copy` | local | Copy last assistant message |
| `/cost` | local | Show session cost |
| `/desktop` | local | Desktop mode toggle |
| `/diff` | local-jsx | Show file diffs |
| `/doctor` | local-jsx | Diagnose configuration issues |
| `/effort` | local-jsx | Set effort level |
| `/exit` | local | Exit the application |
| `/export` | local-jsx | Export conversation |
| `/fast` | local | Toggle fast mode |
| `/feedback` | prompt | Send feedback |
| `/files` | local | List tracked files |
| `/heapdump` | local | Dump heap (debugging) |
| `/help` | local-jsx | Show help |
| `/hooks` | local-jsx | Manage hooks |
| `/ide` | local-jsx | IDE extension management |
| `/init` | prompt | Initialize project configuration |
| `/install-github-app` | local-jsx | Install GitHub App |
| `/install-slack-app` | local-jsx | Install Slack App |
| `/keybindings` | local-jsx | Manage keyboard shortcuts |
| `/login` | local-jsx | Log in (non-3P only) |
| `/logout` | local-jsx | Log out (non-3P only) |
| `/mcp` | local-jsx | MCP server management |
| `/memory` | local-jsx | View/manage memories |
| `/mobile` | local-jsx | Mobile QR code |
| `/model` | local-jsx | Change model |
| `/output-style` | local-jsx | Change output style |
| `/passes` | local-jsx | Manage passes |
| `/permissions` | local-jsx | View/manage permissions |
| `/plan` | local | Toggle plan mode |
| `/plugin` | local-jsx | Plugin management |
| `/pr-comments` | prompt | Review PR comments |
| `/privacy-settings` | local-jsx | Privacy settings |
| `/release-notes` | local | Show changelog |
| `/reload-plugins` | local | Reload plugins |
| `/remote-env` | local-jsx | Remote environment config |
| `/rename` | local | Rename session |
| `/resume` | local-jsx | Resume previous session |
| `/review` | prompt | Code review |
| `/rewind` | local-jsx | Rewind conversation to a specific message |
| `/sandbox-toggle` | local | Toggle sandbox mode |
| `/security-review` | prompt | Security review |
| `/session` | local-jsx | Session management |
| `/skills` | local-jsx | List available skills |
| `/stats` | local-jsx | Show statistics |
| `/status` | local | Show agent status |
| `/stickers` | local-jsx | Stickers |
| `/tag` | local | Tag session |
| `/tasks` | local-jsx | Task management |
| `/terminalSetup` | local-jsx | Terminal setup |
| `/theme` | local-jsx | Change theme |
| `/thinkback` | local | Replay thinking |
| `/thinkback-play` | local | Animated thinking playback |
| `/upgrade` | local-jsx | Upgrade Claude Code |
| `/usage` | local-jsx | Show usage info |
| `/vim` | local-jsx | Toggle vim mode |

**Feature-gated commands** (conditionally available):

| Command | Gate | Description |
|---------|------|-------------|
| `/assistant` | KAIROS | Assistant mode |
| `/brief` | KAIROS / KAIROS_BRIEF | Brief overview |
| `/bridge` | BRIDGE_MODE | Bridge mode |
| `/buddy` | BUDDY | Buddy agent |
| `/fork` | FORK_SUBAGENT | Fork sub-agent |
| `/force-snip` | HISTORY_SNIP | Force history snip |
| `/peers` | UDS_INBOX | Peer agents |
| `/proactive` | PROACTIVE / KAIROS | Proactive mode |
| `/remote-setup` | CCR_REMOTE_SETUP | Remote setup |
| `/subscribe-pr` | KAIROS_GITHUB_WEBHOOKS | Subscribe to PR |
| `/torch` | TORCH | Torch mode |
| `/ultraplan` | ULTRAPLAN | Ultra planning |
| `/voice` | VOICE_MODE | Voice mode |
| `/workflows` | WORKFLOW_SCRIPTS | Workflow scripts |

**Internal-only commands** (ant USER_TYPE):

`/backfill-sessions`, `/break-cache`, `/bughunter`, `/commit`, `/commit-push-pr`, `/ctx-viz`, `/good-claude`, `/issue`, `/init-verifiers`, `/mock-limits`, `/bridge-kick`, `/version`, `/reset-limits`, `/onboarding`, `/share`, `/summary`, `/teleport`, `/ant-trace`, `/perf-issue`, `/env`, `/oauth-refresh`, `/debug-tool-call`, `/agents-platform`, `/autofix-pr`

### The /compact Command (commands/compact/)

Registration (compact/index.ts:4-15):
```typescript
{
  type: 'local',
  name: 'compact',
  description: 'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_COMPACT),
  supportsNonInteractive: true,
  argumentHint: '<optional custom summarization instructions>',
  load: () => import('./compact.js'),
}
```

Execution (compact/compact.ts:40-137):
1. Gets messages after compact boundary (REPL snip awareness)
2. If no custom instructions: tries session memory compaction first
3. If reactive-only mode: routes through reactive compact path
4. Otherwise: runs microcompact, then traditional `compactConversation()`
5. Returns `{ type: 'compact', compactionResult, displayText }`
6. Display text includes shortcut hint for viewing full summary (`ctrl+o` for transcript)

---

## Memory System

### Storage Architecture (memdir/paths.ts)

**Base directory**: `~/.claude/` (or `CLAUDE_CODE_REMOTE_MEMORY_DIR` override)

**Auto-memory path** resolution (paths.ts:223-235):
1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (full path, for Cowork)
2. `autoMemoryDirectory` in settings.json (trusted sources only: policy/local/user -- not project settings for security)
3. `<memoryBase>/projects/<sanitized-git-root>/memory/` (default)

Git worktrees of the same repo share one memory directory (uses canonical git root).

Path validation rejects: relative paths, root/near-root, Windows drive roots, UNC paths, null bytes.

**Enablement** (paths.ts:30-55): enabled by default. Disabled by:
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY` env var
- `--bare` mode
- Remote mode without `CLAUDE_CODE_REMOTE_MEMORY_DIR`
- `autoMemoryEnabled: false` in settings

### Memory Types (memdir/memoryTypes.ts)

Four types in a closed taxonomy:

```typescript
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
```

1. **user**: information about the user's role, goals, knowledge, preferences. Always private.
2. **feedback**: guidance on how to approach work -- both corrections and confirmations. Structure: rule, **Why:** line, **How to apply:** line.
3. **project**: ongoing work, goals, incidents not derivable from code/git. Includes absolute dates. Bias toward team scope.
4. **reference**: pointers to external systems (Linear projects, Grafana dashboards, Slack channels). Usually team scope.

**What NOT to save**: code patterns, architecture, git history, debugging solutions, CLAUDE.md content, ephemeral task details. These exclusions apply even on explicit user request.

### MEMORY.md Index (memdir/memdir.ts)

**Entrypoint**: `MEMORY.md` in the memory directory. It is an **index**, not a memory.

- Loaded into context automatically on every conversation
- Line cap: 200 lines (`MAX_ENTRYPOINT_LINES`)
- Byte cap: 25,000 bytes (`MAX_ENTRYPOINT_BYTES`)
- Truncated with a warning if exceeded (memdir.ts:57-103)
- Each entry: one line, ~150 chars: `- [Title](file.md) -- one-line hook`
- No frontmatter in MEMORY.md itself

**Memory files** have YAML frontmatter (memoryTypes.ts:261-271):
```yaml
---
name: {{memory name}}
description: {{one-line description}}
type: {{user, feedback, project, reference}}
---
{{content}}
```

### Memory Scanning (memdir/memoryScan.ts)

`scanMemoryFiles(memoryDir, signal)`:
- Recursively reads all `.md` files (excluding MEMORY.md)
- Reads first 30 lines to parse frontmatter
- Returns `MemoryHeader[]` sorted newest-first
- Capped at 200 files (`MAX_MEMORY_FILES`)
- Each header: `{ filename, filePath, mtimeMs, description, type }`

`formatMemoryManifest(memories)`: one-line-per-file text for prompts:
```
- [type] filename (ISO timestamp): description
```

### Relevant Memory Selection (memdir/findRelevantMemories.ts)

**When**: at query time, when memory seems relevant to the user's prompt.

**How**:
1. Scans all memory files, filtering out already-surfaced paths
2. Sends the manifest + user query to Sonnet via `sideQuery()`
3. System prompt instructs: "select up to 5 memories that will clearly be useful"
4. Uses JSON schema output format for structured response
5. Returns absolute file paths + mtime for selected memories
6. Active tool references are passed to avoid re-surfacing API docs the model is already using

### Memory Freshness (memdir/memoryAge.ts)

Memories older than 1 day get a staleness caveat:
```
This memory is N days old. Memories are point-in-time observations, not live state --
claims about code behavior or file:line citations may be outdated.
Verify against current code before asserting as fact.
```

Recall guidance (memoryTypes.ts:240-256): before recommending from memory, verify file paths exist, grep for functions/flags, and treat memory as claims about past state, not present truth.

### Memory Loading into Context

Two paths:

1. **System prompt** (`loadMemoryPrompt()`, memdir.ts:419-507): builds behavioral instructions (types, what not to save, how to save, when to access). MEMORY.md content is injected via user context (claudeMd aggregation) rather than embedded directly.

2. **Agent memory** (`buildMemoryPrompt()`, memdir.ts:272-316): same behavioral instructions plus embedded MEMORY.md content. Used by sub-agents that don't have the claudeMd pipeline.

3. **Assistant daily-log mode** (KAIROS, memdir.ts:327-370): long-lived sessions use append-only daily log files (`<memoryDir>/logs/YYYY/MM/YYYY-MM-DD.md`) instead of maintaining MEMORY.md directly. A nightly `/dream` skill distills logs.

### Memory CRUD Operations

- **Create**: Write file with frontmatter to memory dir, add one-line pointer to MEMORY.md
- **Read**: MEMORY.md loaded automatically; individual files read via FileRead tool on demand; relevant memories surfaced via Sonnet-based selection
- **Update**: Edit existing memory file, update MEMORY.md entry
- **Delete**: Remove file, remove line from MEMORY.md
- **Search**: Grep tool against `<memoryDir>/**/*.md` or session transcript `.jsonl` files

The prompt explicitly tells the model the directory exists and to write directly (no mkdir needed).

---

## Keybinding System

### Architecture

**Files**:
- `keybindings/defaultBindings.ts`: built-in bindings
- `keybindings/schema.ts`: Zod schema for validation
- `keybindings/loadUserBindings.ts`: user config loader with hot-reload
- `keybindings/parser.ts`: key string parsing
- `keybindings/match.ts`: input matching
- `keybindings/resolver.ts`: context-aware binding resolution
- `keybindings/reservedShortcuts.ts`: protected shortcuts (ctrl+c, ctrl+d)
- `keybindings/validate.ts`: validation with warnings
- `keybindings/template.ts`: default keybindings.json template
- `keybindings/useKeybinding.ts`: React hook for keybinding consumption

### Contexts (schema.ts:12-32)

17 contexts, each scoping when bindings are active:

| Context | Description |
|---------|-------------|
| `Global` | Active everywhere |
| `Chat` | Chat input focused |
| `Autocomplete` | Autocomplete menu visible |
| `Confirmation` | Permission/confirmation dialog |
| `Help` | Help overlay open |
| `Transcript` | Viewing transcript |
| `HistorySearch` | Searching command history (ctrl+r) |
| `Task` | Task/agent running in foreground |
| `ThemePicker` | Theme picker open |
| `Settings` | Settings menu open |
| `Tabs` | Tab navigation active |
| `Attachments` | Image attachment navigation |
| `Footer` | Footer indicators focused |
| `MessageSelector` | Rewind dialog |
| `DiffDialog` | Diff dialog |
| `ModelPicker` | Model picker |
| `Select` | Select/list component |
| `Plugin` | Plugin dialog |

### Default Bindings (defaultBindings.ts:32-340)

Key defaults by context:

**Global**:
- `ctrl+c` -> `app:interrupt` (reserved, cannot rebind)
- `ctrl+d` -> `app:exit` (reserved, cannot rebind)
- `ctrl+l` -> `app:redraw`
- `ctrl+t` -> `app:toggleTodos`
- `ctrl+o` -> `app:toggleTranscript`
- `ctrl+r` -> `history:search`

**Chat**:
- `escape` -> `chat:cancel`
- `shift+tab` / `meta+m` (Windows fallback) -> `chat:cycleMode`
- `meta+p` -> `chat:modelPicker`
- `meta+o` -> `chat:fastMode`
- `meta+t` -> `chat:thinkingToggle`
- `enter` -> `chat:submit`
- `up` / `down` -> `history:previous` / `history:next`
- `ctrl+_` / `ctrl+shift+-` -> `chat:undo`
- `ctrl+x ctrl+e` -> `chat:externalEditor`
- `ctrl+g` -> `chat:externalEditor`
- `ctrl+s` -> `chat:stash`
- `alt+v` (Windows) / `ctrl+v` (other) -> `chat:imagePaste`

**Autocomplete**: `tab` accept, `escape` dismiss, `up`/`down` navigate

**Confirmation**: `y`/`enter` yes, `n`/`escape` no, `shift+tab` cycleMode, `ctrl+e` toggleExplanation

**Transcript**: `ctrl+e` toggleShowAll, `escape`/`ctrl+c`/`q` exit

**Scroll**: `pageup`/`pagedown`, `wheelup`/`wheeldown`, `ctrl+home`/`ctrl+end`, `ctrl+shift+c`/`cmd+c` copy

### Actions (schema.ts:64-172)

72 named actions across all contexts. Actions follow `context:action` naming. Special:
- `command:<name>` pattern allows binding keys directly to slash commands
- `null` value unbinds a default shortcut

### User Customization (loadUserBindings.ts)

**File**: `~/.claude/keybindings.json`

**Format** (schema.ts:214-229):
```json
{
  "$schema": "...",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+k": "chat:cancel",
        "ctrl+enter": "chat:newline"
      }
    }
  ]
}
```

**Loading** (loadUserBindings.ts:133-237):
1. Parse JSON file
2. Extract `bindings` array from object wrapper
3. Validate structure (array of blocks, each with context + bindings)
4. Parse user bindings
5. Merge: `[...defaultBindings, ...userParsed]` (user overrides last-wins)
6. Run validation, check for duplicate keys in raw JSON
7. Return merged bindings + warnings

**Hot-reload**: chokidar watches `keybindings.json` with 500ms stability threshold. Changes trigger re-parse and emit via signal to all subscribers. Deletion resets to defaults.

**Gating**: user customization currently gated behind `tengu_keybinding_customization_release` feature flag.

### Platform Handling

- Windows VT mode detection for `shift+tab` reliability (Node >= 22.17.0, Bun >= 1.2.23)
- Image paste: `alt+v` on Windows, `ctrl+v` elsewhere
- Kitty keyboard protocol support for `cmd+` bindings

---

## Session History and Transcripts

### Prompt History (history.ts)

**Storage**: `~/.claude/history.jsonl` -- global across all projects, append-only JSONL.

**Entry format** (`LogEntry`, history.ts:219-225):
```typescript
type LogEntry = {
  display: string                              // User-visible prompt text
  pastedContents: Record<number, StoredPastedContent>  // Paste references
  timestamp: number                            // Date.now()
  project: string                              // Project root path
  sessionId?: string                           // Session UUID
}
```

**Pasted content**: small pastes (<=1024 chars) stored inline; large pastes stored externally via content-hash in a paste store. Images excluded from history storage.

**Writing** (history.ts:355-434):
- Entries buffered in `pendingEntries[]`
- Flushed to disk asynchronously with file locking (`lockfile`)
- Retries up to 5 times with 500ms sleep between attempts
- Cleanup handler registered to flush on process exit

**Reading** (`getHistory()`, history.ts:190-217):
- Current session entries yielded first (prevents interleaving with concurrent sessions)
- Max 100 entries per project
- Reads JSONL in reverse (newest first) via `readLinesReverse()`
- Deduplication by display text in `getTimestampedHistory()` (for ctrl+r picker)

**Undo** (`removeLastFromHistory()`, history.ts:453-464): removes the most-recently-added entry. Fast path pops from pending buffer; slow path (already flushed) adds timestamp to skip-set consulted by readers.

### Paste References (history.ts:47-100)

Format: `[Pasted text #1 +10 lines]`, `[Image #2]`
- IDs are auto-incrementing per prompt (not globally unique)
- `expandPastedTextRefs()` replaces placeholders with actual content
- Reverse-order splicing prevents offset drift

### Session Transcripts

**Storage**: `~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl`

**Format**: JSONL (one JSON object per line, each representing a message)

**Path resolution** (`getTranscriptPath()`, sessionStorage.ts:202-205):
```
join(projectDir, `${sessionId}.jsonl`)
```

where `projectDir = ~/.claude/projects/<sanitized-cwd>/`

**Sub-agent transcripts**: `<projectDir>/<sessionId>/agent-<agentId>.jsonl`

**Size cap**: 50MB warning threshold for session JSONL files.

**Transcript in compaction**: the transcript path is included in the compact summary message so the model can read the full pre-compaction conversation if needed:
```
If you need specific details from before compaction, read the full transcript at: <path>
```

### Session History API (assistant/sessionHistory.ts)

For cloud-stored sessions (CCR / remote):
- `fetchLatestEvents(ctx, limit)`: newest page of events (default 100)
- `fetchOlderEvents(ctx, beforeId, limit)`: pagination backward
- Uses OAuth authentication with anthropic-beta headers
- Endpoint: `{BASE_API_URL}/v1/sessions/{sessionId}/events`
- Response: `{ data: SDKMessage[], has_more, first_id, last_id }`

---

## Key Interfaces and Types

### CompactionResult (compact.ts:299-311)

```typescript
interface CompactionResult {
  boundaryMarker: SystemMessage        // Compact boundary marker with metadata
  summaryMessages: UserMessage[]       // The summary as user messages
  attachments: AttachmentMessage[]     // Post-compact file/skill/tool attachments
  hookResults: HookResultMessage[]     // SessionStart hook results
  messagesToKeep?: Message[]           // Preserved recent messages (session memory compact)
  userDisplayMessage?: string          // Hook-provided display text
  preCompactTokenCount?: number        // Tokens before compaction
  postCompactTokenCount?: number       // Compact API call total usage
  truePostCompactTokenCount?: number   // Actual resulting context size estimate
  compactionUsage?: TokenUsage         // API usage metrics for the compact call
}
```

### Command (types/command.ts)

```typescript
type Command = (LocalCommand | LocalJSXCommand | PromptCommand) & CommandBase
```

Where `CommandBase` provides: name, aliases, description, isEnabled, isHidden, availability, argumentHint, whenToUse, version, disableModelInvocation, loadedFrom, kind, immediate.

### MemoryHeader (memoryScan.ts:13-19)

```typescript
type MemoryHeader = {
  filename: string           // Relative path within memory dir
  filePath: string           // Absolute path
  mtimeMs: number            // Last modification time
  description: string | null // From frontmatter
  type: MemoryType | undefined  // user | feedback | project | reference
}
```

### AutoCompactTrackingState (autoCompact.ts:51-60)

```typescript
type AutoCompactTrackingState = {
  compacted: boolean          // Whether compaction happened this chain
  turnCounter: number         // Turns since last compact
  turnId: string              // Unique ID per turn
  consecutiveFailures?: number // Circuit breaker counter (max 3)
}
```

### SessionMemoryCompactConfig (sessionMemoryCompact.ts:47-54)

```typescript
type SessionMemoryCompactConfig = {
  minTokens: number           // Default: 10,000
  minTextBlockMessages: number // Default: 5
  maxTokens: number           // Default: 40,000
}
```

### KeybindingBlock (used by defaultBindings.ts and user config)

```typescript
type KeybindingBlock = {
  context: KeybindingContext    // One of 17 contexts
  bindings: Record<string, KeybindingAction | `command:${string}` | null>
}
```

### ParsedBinding (from parser.ts)

```typescript
type ParsedBinding = {
  context: string
  keys: ParsedKey[]     // Parsed key sequence (supports chord bindings like ctrl+x ctrl+k)
  action: string        // Action identifier or null for unbind
}
```
