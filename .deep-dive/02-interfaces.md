# Claude Code CLI -- Interface Analysis

> Source: `C:\Users\alfio\Downloads\aaa\src` (~1902 files)
> Analysis date: 2026-04-04

---

## 1. The Prompt Assembly Pipeline

### 1.1 Entry Point: `getSystemPrompt()`

**File**: `constants/prompts.ts`

```typescript
export async function getSystemPrompt(
  mcpClients: MCPServerConnection[],
  model: string,
): Promise<string[]>
```

Returns an array of prompt strings. The caller joins them with `\n` or passes them as separate system messages.

### 1.2 System Prompt Sections

**File**: `constants/systemPromptSections.ts`

```typescript
type SystemPromptSection = {
  name: string
  compute: ComputeFn  // () => string | null | Promise<string | null>
  cacheBreak: boolean
}

// Memoized (computed once, cached until /clear or /compact)
function systemPromptSection(name: string, compute: ComputeFn): SystemPromptSection

// Recomputes every turn -- BREAKS prompt cache when value changes
function DANGEROUS_uncachedSystemPromptSection(
  name: string, compute: ComputeFn, reason: string
): SystemPromptSection

// Resolve all sections, returning prompt strings
async function resolveSystemPromptSections(
  sections: SystemPromptSection[]
): Promise<(string | null)[]>

// Clear cache (called on /clear, /compact)
function clearSystemPromptSections(): void
```

### 1.3 Prompt Structure

The system prompt is assembled from these sections (in order):

1. **Static boundary marker** (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`) -- everything before this can use global cache scope
2. **Intro** -- agent identity, cyber risk instruction
3. **System** -- tool results, tags, hooks, compression explanation
4. **Doing Tasks** -- software engineering guidelines, code style, error reporting
5. **Actions** -- reversibility, blast radius, confirmation guidelines
6. **Using Your Tools** -- tool-specific usage guidance
7. **Memory** -- MEMORY.md content (from `memdir/memdir.ts`)
8. **MCP Instructions** -- per-server instructions
9. **Output Style** -- custom output style prompt (if configured)
10. **Language** -- response language preference
11. **Coordinator context** -- (if coordinator mode) worker tool listing
12. **User context** -- git status, CLAUDE.md, date, branch

### 1.4 Context Assembly

**File**: `context.ts`

```typescript
// Both are memoized -- clear on /clear or /compact
const getUserContext: () => Promise<{[k: string]: string}>
const getSystemContext: () => Promise<{[k: string]: string}>
```

`getUserContext()` returns: git status, branch, CLAUDE.md contents, date, worktree info.

`getSystemContext()` returns: OS info, shell, platform, environment.

---

## 2. The Agent Loop (query.ts)

### 2.1 Core Query Function

**File**: `query.ts`

The query loop is the central agent loop. It:
1. Prepares system prompt and messages
2. Calls the model with streaming
3. Processes tool use blocks
4. Handles compaction
5. Continues until stop reason or interruption

Key types:

```typescript
// query/config.ts
type QueryConfig = {
  sessionId: SessionId
  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

// query/deps.ts -- injectable for testing
type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded
  uuid: () => string
}
```

### 2.2 Model Streaming

**File**: `services/api/claude.ts`

```typescript
function queryModelWithStreaming(params: {
  messages: MessageParam[]
  systemPrompt: SystemPrompt
  tools: Tools
  model: string
  thinkingConfig: ThinkingConfig
  // ... many more options
}): AsyncGenerator<StreamEvent>
```

Stream events include:
- `request_start` -- API request initiated
- `content_block_start/delta/stop` -- streaming content blocks
- `message_start/delta/stop` -- message lifecycle

### 2.3 Token Budget

**File**: `query/tokenBudget.ts`

```typescript
type BudgetTracker = {
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  startedAt: number
}

function createBudgetTracker(): BudgetTracker
function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision  // 'continue' with nudge or 'stop'
```

---

## 3. The Tool System

### 3.1 Tool Interface

**File**: `Tool.ts`

```typescript
type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  name: string
  aliases?: string[]
  searchHint?: string
  inputSchema: Input                    // Zod schema
  inputJSONSchema?: ToolInputJSONSchema // Alternative JSON Schema (MCP tools)
  outputSchema?: z.ZodType<unknown>
  maxResultSizeChars: number
  strict?: boolean
  shouldDefer?: boolean
  alwaysLoad?: boolean
  isMcp?: boolean
  isLsp?: boolean
  mcpInfo?: { serverName: string; toolName: string }

  // Core methods
  call(args, context, canUseTool, parentMessage, onProgress?): Promise<ToolResult<Output>>
  description(input, options): Promise<string>
  prompt(options): Promise<string>
  checkPermissions(input, context): Promise<PermissionResult>

  // Classification
  isEnabled(): boolean
  isReadOnly(input): boolean
  isConcurrencySafe(input): boolean
  isDestructive?(input): boolean
  isSearchOrReadCommand?(input): { isSearch: boolean; isRead: boolean; isList?: boolean }
  isOpenWorld?(input): boolean
  interruptBehavior?(): 'cancel' | 'block'
  requiresUserInteraction?(): boolean

  // Validation
  validateInput?(input, context): Promise<ValidationResult>
  inputsEquivalent?(a, b): boolean

  // Permissions
  preparePermissionMatcher?(input): Promise<(pattern: string) => boolean>
  getPath?(input): string

  // Display
  userFacingName(input): string
  userFacingNameBackgroundColor?(input): keyof Theme | undefined
  getToolUseSummary?(input): string | null
  getActivityDescription?(input): string | null
  toAutoClassifierInput(input): unknown

  // Result handling
  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
  renderToolResultMessage?(content, progressMessages, options): React.ReactElement | null

  // Input normalization
  backfillObservableInput?(input: Record<string, unknown>): void
  isTransparentWrapper?(): boolean
}
```

### 3.2 Tool Result

```typescript
type ToolResult<T> = {
  data: T
  newMessages?: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage)[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
}
```

### 3.3 Tool Use Context

**File**: `Tool.ts` -- The mega-context passed to every tool call:

```typescript
type ToolUseContext = {
  options: {
    commands: Command[]
    debug: boolean
    mainLoopModel: string
    tools: Tools
    verbose: boolean
    thinkingConfig: ThinkingConfig
    mcpClients: MCPServerConnection[]
    mcpResources: Record<string, ServerResource[]>
    isNonInteractiveSession: boolean
    agentDefinitions: AgentDefinitionsResult
    maxBudgetUsd?: number
    customSystemPrompt?: string
    appendSystemPrompt?: string
    querySource?: QuerySource
    refreshTools?: () => Tools
  }
  abortController: AbortController
  readFileState: FileStateCache
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  setAppStateForTasks?: (f: (prev: AppState) => AppState) => void
  messages: Message[]
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void
  setResponseLength: (f: (prev: number) => number) => void
  updateFileHistoryState: (updater: (prev: FileHistoryState) => FileHistoryState) => void
  updateAttributionState: (updater: (prev: AttributionState) => AttributionState) => void

  // UI callbacks (optional -- only in REPL mode)
  setToolJSX?: SetToolJSXFn
  addNotification?: (notif: Notification) => void
  appendSystemMessage?: (msg: SystemMessage) => void
  sendOSNotification?: (opts: { message: string; notificationType: string }) => void
  openMessageSelector?: () => void
  setStreamMode?: (mode: SpinnerMode) => void
  setSDKStatus?: (status: SDKStatus) => void
  setConversationId?: (id: UUID) => void
  setHasInterruptibleToolInProgress?: (v: boolean) => void
  pushApiMetricsEntry?: (ttftMs: number) => void
  onCompactProgress?: (event: CompactProgressEvent) => void

  // Permission/hook callbacks
  handleElicitation?: (serverName, params, signal) => Promise<ElicitResult>
  requestPrompt?: (sourceName, toolInputSummary?) => (request: PromptRequest) => Promise<PromptResponse>

  // Sub-agent context
  agentId?: AgentId
  agentType?: string
  toolUseId?: string
  queryTracking?: QueryChainTracking
  requireCanUseTool?: boolean
  localDenialTracking?: DenialTrackingState
  preserveToolUseResults?: boolean

  // Memory/skill triggers
  nestedMemoryAttachmentTriggers?: Set<string>
  loadedNestedMemoryPaths?: Set<string>
  dynamicSkillDirTriggers?: Set<string>
  discoveredSkillNames?: Set<string>

  // Tool-level state
  toolDecisions?: Map<string, { source: string; decision: string; timestamp: number }>
  contentReplacementState?: ContentReplacementState
  renderedSystemPrompt?: SystemPrompt
  fileReadingLimits?: { maxTokens?: number; maxSizeBytes?: number }
  globLimits?: { maxResults?: number }
  criticalSystemReminder_EXPERIMENTAL?: string
  userModified?: boolean
}
```

### 3.4 Tool Orchestration

**File**: `services/tools/toolOrchestration.ts`

```typescript
async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void>
```

Partitions tool calls into:
- **Concurrent batch** (all `isConcurrencySafe` = true) -- runs up to `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10) in parallel
- **Serial batch** (any non-concurrent-safe) -- runs one at a time

### 3.5 Tool Registration

**File**: `tools.ts`

```typescript
function getTools(options: {
  mcpTools?: Tool[]
  enabledMcpToolNames?: Set<string>
  lspTools?: Tool[]
  customTools?: Tool[]
  pluginTools?: Tool[]
}): Tools  // Tool[]
```

Merges built-in tools + MCP tools + LSP tools + custom tools + plugin tools. Deduplication by name.

### 3.6 Tool Name Constants

**File**: `constants/tools.ts`

```typescript
const ALL_AGENT_DISALLOWED_TOOLS: Set<string>    // Tools agents can't use
const CUSTOM_AGENT_DISALLOWED_TOOLS: Set<string>  // Tools custom agents can't use
const ASYNC_AGENT_ALLOWED_TOOLS: Set<string>       // Tools allowed for async agents
const COORDINATOR_MODE_ALLOWED_TOOLS: Set<string>  // Tools for coordinator mode
const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS: Set<string> // Extra tools for teammates
```

---

## 4. The Compaction System

### 4.1 Auto-Compaction

**File**: `services/compact/autoCompact.ts`

```typescript
type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  turnId: string
  consecutiveFailures?: number
}

function getEffectiveContextWindowSize(model: string): number
// Returns context window minus output token reserve

async function autoCompactIfNeeded(
  messages: Message[],
  context: ToolUseContext,
  // ... tracking state, cache params
): Promise<{ compacted: boolean; messages: Message[] }>
```

Triggers when estimated token count exceeds `getEffectiveContextWindowSize()`.

### 4.2 Manual Compaction

**File**: `services/compact/compact.ts`

```typescript
type CompactionResult = {
  success: boolean
  summary?: string
  messages: Message[]
  error?: string
}

async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  // ... options
): Promise<CompactionResult>
```

Uses a forked agent to summarize the conversation, then replaces old messages with a compact boundary message containing the summary.

### 4.3 Micro-Compaction

**File**: `services/compact/microCompact.ts`

Lighter-weight compaction for tool results that are getting too large. Compresses individual message content without full conversation summarization.

### 4.4 Post-Compaction

**File**: `services/compact/postCompactCleanup.ts`

Cleanup after compaction: re-attaches memory files, delta attachments for MCP instructions, deferred tools, and agent listings.

---

## 5. The Command System

### 5.1 Command Type

**File**: `types/command.ts`

```typescript
type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  contentLength: number
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  context?: 'inline' | 'fork'
  agent?: string
  effort?: EffortValue
  paths?: string[]
  hooks?: HooksSettings
  skillRoot?: string
  pluginInfo?: { pluginManifest: PluginManifest; repository: string }
  disableNonInteractive?: boolean
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}

type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<LocalCommandModule>
}

type LocalJSXCommand = {
  type: 'local-jsx'
  call(args, context: LocalJSXCommandContext): React.ReactElement
}

type Command = {
  name: string
  aliases?: string[]
  description: string
  isEnabled(): boolean
  isHidden?: boolean
  argDescription?: string
} & (PromptCommand | LocalCommand | LocalJSXCommand)
```

### 5.2 Command Registration

**File**: `commands.ts`

```typescript
function getCommands(): Command[]
function filterCommandsForRemoteMode(commands: Command[]): Command[]
function getSlashCommandToolSkills(): Command[]
function getSkillToolCommands(): Command[]
```

Commands are imported statically and assembled into a flat array. Feature-gated commands use conditional `require()`.

### 5.3 Command Result Types

```typescript
type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'compact'; compactionResult: CompactionResult; displayText?: string }
  | { type: 'skip' }
```

---

## 6. The Permission System

### 6.1 Permission Types

**File**: `types/permissions.ts`

```typescript
type PermissionMode =
  | 'acceptEdits'      // Auto-accept file edits
  | 'bypassPermissions' // Skip all permission checks
  | 'default'          // Ask for dangerous operations
  | 'dontAsk'          // Auto-accept everything
  | 'plan'             // Read-only plan mode
  | 'auto'             // AI-classified auto-approve
  | 'bubble'           // Internal mode

type PermissionBehavior = 'allow' | 'deny' | 'ask'

type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: { toolName: string; ruleContent?: string }
}

type PermissionRuleSource =
  | 'userSettings' | 'projectSettings' | 'localSettings'
  | 'flagSettings' | 'policySettings' | 'cliArg' | 'command' | 'session'
```

### 6.2 Permission Context

**File**: `Tool.ts`

```typescript
type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules: ToolPermissionRulesBySource
  alwaysAskRules: ToolPermissionRulesBySource
  isBypassPermissionsModeAvailable: boolean
  isAutoModeAvailable?: boolean
  strippedDangerousRules?: ToolPermissionRulesBySource
  shouldAvoidPermissionPrompts?: boolean
  awaitAutomatedChecksBeforeDialog?: boolean
  prePlanMode?: PermissionMode
}>
```

### 6.3 Permission Check Flow

Each tool implements `checkPermissions(input, context)` returning:

```typescript
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; reason: string }
  | { behavior: 'ask'; /* ... UI display data */ }
```

The `canUseTool` callback (from `hooks/useCanUseTool.tsx`) orchestrates the full permission check including hooks, classifier, and user prompt.

---

## 7. The Hook System

### 7.1 Hook Events

**File**: `entrypoints/sdk/coreTypes.ts`

```typescript
const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd',
  'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'PermissionDenied',
  'Setup', 'TeammateIdle',
  'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged',
] as const
```

### 7.2 Hook Response Schema

**File**: `types/hooks.ts`

```typescript
// Sync hooks (PreToolUse, UserPromptSubmit)
type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse'
    permissionDecision?: PermissionBehavior
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    additionalContext?: string
  } | {
    hookEventName: 'UserPromptSubmit'
    updatedUserPrompt?: string
    additionalSystemContext?: string
  }
}

// Prompt elicitation
type PromptRequest = {
  prompt: string     // request id
  message: string
  options: Array<{ key: string; label: string; description?: string }>
}

type PromptResponse = {
  prompt_response: string  // request id
  selected: string
}
```

---

## 8. The State System

### 8.1 Bootstrap State (Global Singleton)

**File**: `bootstrap/state.ts`

Module-level mutable state accessed synchronously from anywhere. Key fields:

```typescript
type State = {
  // Session identity
  sessionId: SessionId
  parentSessionId: SessionId | undefined
  originalCwd: string
  projectRoot: string
  cwd: string

  // Model
  mainLoopModelOverride: ModelSetting | undefined
  initialMainLoopModel: ModelSetting
  modelStrings: ModelStrings | null

  // Cost tracking
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  modelUsage: { [modelName: string]: ModelUsage }

  // Turn metrics
  turnHookDurationMs: number
  turnToolDurationMs: number
  turnClassifierDurationMs: number
  turnToolCount: number
  turnHookCount: number
  turnClassifierCount: number

  // Session state
  isInteractive: boolean
  startTime: number
  lastInteractionTime: number
  totalLinesAdded: number
  totalLinesRemoved: number

  // Telemetry
  meter: Meter | null
  sessionCounter: AttributedCounter | null
  // ... more counters

  // Feature state
  kairosActive: boolean
  strictToolResultPairing: boolean
  sdkAgentProgressSummariesEnabled: boolean
  clientType: string

  // System prompt section cache
  systemPromptSectionCache: Map<string, string | null>
}
```

### 8.2 AppState (React External Store)

**File**: `state/AppStateStore.ts`

```typescript
type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  mainLoopModelForSession: ModelSetting
  statusLineText: string | undefined
  expandedView: 'none' | 'tasks' | 'teammates'
  isBriefOnly: boolean

  // Permissions
  toolPermissionContext: ToolPermissionContext
  denialTracking: DenialTrackingState

  // MCP
  mcpClients: MCPServerConnection[]
  mcpResources: Record<string, ServerResource[]>

  // Tools & Commands
  tools: Tool[]
  commands: Command[]
  agentDefinitions: AgentDefinitionsResult

  // Messages
  messages: Message[]
  hasNewOutput: boolean

  // Tasks
  tasks: TaskState[]
  todoList: TodoList | null
  todoVisible: boolean

  // Teams
  teamContext?: { teamId: string; leaderId: string }

  // File history
  fileHistoryState: FileHistoryState
  attributionState: AttributionState

  // Plugins
  loadedPlugins: LoadedPlugin[]
  pluginErrors: PluginError[]

  // Session hooks
  sessionHooks: SessionHooksState

  // Speculation
  speculationState: SpeculationState

  // Bridge
  bridgePermissionCallbacks?: BridgePermissionCallbacks
  channelPermissionCallbacks?: ChannelPermissionCallbacks

  // UI state
  thinkingEnabled: boolean
  enablePromptSuggestion: boolean
  notifications: Notification[]
  elicitationRequests: ElicitationRequestEvent[]

  // ... more fields
}>
```

### 8.3 Store Implementation

**File**: `state/store.ts`

Generic external sync store pattern (compatible with `useSyncExternalStore`):

```typescript
type Store<T> = {
  getState(): T
  setState(updater: (prev: T) => T): void
  subscribe(listener: () => void): () => void
}
```

---

## 9. The SDK Interface

### 9.1 Public SDK API

**File**: `entrypoints/agentSdkTypes.ts`

```typescript
// One-shot query
function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query

// Multi-turn session (unstable)
function unstable_v2_createSession(options: SDKSessionOptions): SDKSession
function unstable_v2_resumeSession(sessionId: string, options: SDKSessionOptions): SDKSession
function unstable_v2_prompt(message: string, options: SDKSessionOptions): Promise<SDKResultMessage>

// Session management
function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>
function getSessionMessages(sessionId: string, options?): Promise<SessionMessage[]>
function getSessionInfo(sessionId: string, options?): Promise<SDKSessionInfo | undefined>
function renameSession(sessionId: string, title: string, options?): Promise<void>
function tagSession(sessionId: string, tag: string | null, options?): Promise<void>
function forkSession(sessionId: string, options?): Promise<ForkSessionResult>

// Custom tools
function tool(name, description, inputSchema, handler, extras?): SdkMcpToolDefinition
function createSdkMcpServer(options: { name; version?; tools? }): McpSdpServerConfigWithInstance

// Daemon primitives (internal)
function watchScheduledTasks(opts): ScheduledTasksHandle
function connectRemoteControl(opts): Promise<RemoteControlHandle | null>
```

### 9.2 SDK Message Types

```typescript
type SDKMessage =
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKToolUseMessage
  | SDKToolResultMessage

type SDKStatus = {
  type: string
  // ... varies by status type
}
```

### 9.3 Structured I/O (SDK Bridge)

**File**: `cli/structuredIO.ts`

JSON-lines protocol over stdin/stdout for non-interactive SDK consumers. Handles:
- Permission prompts (tool_use_permission)
- MCP elicitations
- Control requests/responses
- Message streaming

---

## 10. The MCP Integration

### 10.1 MCP Server Configuration

**File**: `services/mcp/types.ts`

```typescript
type McpServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  // ... more fields
}

type MCPServerConnection = {
  name: string
  client: Client        // MCP Client instance
  transport: Transport   // stdio or in-process
  config: McpServerConfig
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  tools: Tool[]
  resources: ServerResource[]
  instructions?: string
}
```

### 10.2 MCP Client Management

**File**: `services/mcp/client.ts`

```typescript
function getMcpToolsCommandsAndResources(
  configs: McpServerConfig[],
  // ... options
): Promise<{
  tools: Tool[]
  commands: Command[]
  resources: Record<string, ServerResource[]>
  clients: MCPServerConnection[]
}>
```

### 10.3 MCP Transports

- `InProcessTransport.ts` -- for SDK MCP servers running in the same process
- `SdkControlTransport.ts` -- for SDK-controlled MCP connections

---

## 11. The Keybinding System

### 11.1 Binding Definition

**File**: `keybindings/defaultBindings.ts`

```typescript
type KeybindingBlock = {
  context: 'Global' | 'Chat' | 'PermissionRequest' | 'Dialog' | /* ... */
  bindings: Record<string, string>  // key-combo -> action-id
}

// Example bindings:
// 'ctrl+c' -> 'app:interrupt'
// 'ctrl+r' -> 'history:search'
// 'enter' -> 'chat:submit'
// 'ctrl+x ctrl+k' -> 'chat:killAgents' (chord)
```

### 11.2 Key Resolution

```
User presses key
  -> parser.ts (parse raw key event)
  -> match.ts (match against binding patterns)
  -> resolver.ts (resolve to action, considering chords)
  -> KeybindingContext.tsx (dispatch action to handler)
```

---

## 12. Memory System

### 12.1 Memory Loading

**File**: `memdir/memdir.ts`

```typescript
const ENTRYPOINT_NAME = 'MEMORY.md'
const MAX_ENTRYPOINT_LINES = 200
const MAX_ENTRYPOINT_BYTES = 25_000

function truncateEntrypointContent(raw: string): EntrypointTruncation

async function loadMemoryPrompt(): Promise<string | null>
// Reads MEMORY.md, truncates, builds prompt section
```

### 12.2 Memory Types

**File**: `memdir/memoryTypes.ts`

Defines memory categories, frontmatter format, what to save/not save, when to access memories.

### 12.3 Memory Scanning

**File**: `memdir/memoryScan.ts` / `findRelevantMemories.ts`

Scans `.claude/memory/` directory for relevant memories.

---

## 13. The Bridge (Remote Control)

### 13.1 Protocol Types

**File**: `bridge/types.ts`

```typescript
type SpawnMode = 'single-session' | 'worktree' | 'same-dir'
type BridgeWorkerType = 'claude_code' | 'claude_code_assistant'
type SessionDoneStatus = 'completed' | 'failed' | 'interrupted'

type WorkSecret = {
  version: number
  session_ingress_token: string
  api_base_url: string
  sources: Array<{ type: string; git_info?: { ... } }>
  auth: Array<{ type: string; token: string }>
  claude_code_args?: Record<string, string> | null
  mcp_config?: unknown | null
  environment_variables?: Record<string, string> | null
}
```

### 13.2 Remote Control Handle (SDK)

```typescript
type RemoteControlHandle = {
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  sendControlRequest(req: unknown): void
  sendControlResponse(res: unknown): void
  sendControlCancelRequest(requestId: string): void
  inboundPrompts(): AsyncGenerator<InboundPrompt>
  controlRequests(): AsyncGenerator<unknown>
  permissionResponses(): AsyncGenerator<unknown>
  onStateChange(cb: (state, detail?) => void): void
  teardown(): Promise<void>
}
```

---

## 14. External Dependencies

### Core

| Package | Usage |
|---------|-------|
| `@anthropic-ai/sdk` | Anthropic API client, message types |
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `react` | UI rendering (via Ink) |
| `zod/v4` | Schema validation |
| `commander` | CLI argument parsing |
| `chalk` | Terminal colors |
| `axios` | HTTP client (bridge, assistant) |
| `lodash-es` | Utility functions |
| `strip-ansi` | ANSI escape stripping |
| `figures` | Unicode symbols |

### Optional/Feature-Gated

| Package | Usage |
|---------|-------|
| `@opentelemetry/*` | Telemetry (lazy-loaded) |
| `bun:bundle` | Build-time feature flags |

---

## 15. How to Add a New Module

### Adding a New Tool

1. Create `tools/<ToolName>/` directory
2. Implement `<ToolName>.tsx` conforming to `Tool<Input, Output, Progress>` interface
3. Add `prompt.ts` with `<TOOL_NAME>_TOOL_NAME` constant and prompt text
4. Add `constants.ts` if needed
5. Register in `tools.ts` `getTools()` function
6. Add to appropriate sets in `constants/tools.ts` (allow/deny for agents)
7. Add prompt section reference in `constants/prompts.ts` if the tool needs system prompt guidance

### Adding a New Command

1. Create `commands/<name>/index.ts` (or `commands/<name>.ts`)
2. Export a `Command` object with `name`, `description`, `type`, and implementation
3. Import and register in `commands.ts` `getCommands()` array
4. Feature-gate with `feature('FLAG')` + conditional `require()` if internal-only

### Adding a New Service

1. Create `services/<name>/` directory
2. Export public API from index file
3. Keep heavy deps lazy-loaded if startup-sensitive
4. Use `bootstrap/state.ts` for global state, not module-level variables

### Adding to System Prompt

1. In `constants/prompts.ts`, create a new section function
2. Wrap with `systemPromptSection('name', computeFn)` for memoization
3. Add to the section array in `getSystemPrompt()`
4. Place before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` if content is static/cacheable

---

## 16. Key Contracts for GUI Replication

### What the GUI Sidecar Needs to Implement

The claude-code-gui sidecar (`sidecar/sidecar.js`) communicates with the Agent SDK. The key interfaces it must handle:

1. **Query lifecycle**: `query()` -> stream of `SDKMessage` events -> result
2. **Tool permissions**: `PreToolUse` hook or permission callback -> approve/deny
3. **Compaction**: Automatic, transparent to the consumer
4. **Session management**: `listSessions()`, `getSessionMessages()`, resume by ID
5. **MCP integration**: Pass-through MCP server configs
6. **Model selection**: `model` parameter on query options

### What the GUI Can Ignore

- Ink rendering layer (replaced by React DOM + xterm.js)
- Terminal-specific code (ANSI, cursor movement, terminal focus)
- Keybinding system (replaced by browser/Tauri keybindings)
- Commander CLI arg parsing
- Auto-update system
- Companion sprite (buddy/)
- Vim mode
- Voice mode
- Bridge/Remote Control (GUI has its own session management)

### What the GUI Should Replicate

- Tool system types and permission model
- Prompt assembly logic (system prompt sections)
- Compaction behavior (auto-compact thresholds)
- Command/slash command system
- Memory system (MEMORY.md, CLAUDE.md)
- Cost tracking
- Session persistence and resume
- Agent/subagent spawning
- MCP server management
