# Claude Code System Prompt Assembly Pipeline

Deep analysis of the prompt assembly pipeline from source at `C:\Users\alfio\Downloads\aaa\src\constants\`.

---

## Prompt Assembly Pipeline (step-by-step flow)

The system prompt is assembled in `getSystemPrompt()` (prompts.ts:444-577) and follows this flow:

1. **Early exit**: If `CLAUDE_CODE_SIMPLE` env var is set, returns a minimal one-liner with CWD + date (prompts.ts:450-453).

2. **Parallel data fetching**: Three async operations run concurrently (prompts.ts:457-461):
   - `getSkillToolCommands(cwd)` - available slash commands
   - `getOutputStyleConfig()` - active output style (Explanatory, Learning, custom, or null)
   - `computeSimpleEnvInfo(model, additionalWorkingDirectories)` - environment context

3. **Settings + tool set**: Loads `getInitialSettings()` and builds a `Set<string>` of enabled tool names (prompts.ts:463-464).

4. **Proactive mode branch**: If proactive mode is active (autonomous agent), returns a completely different prompt structure (prompts.ts:467-489).

5. **Dynamic section registration**: Registers ~10-15 `SystemPromptSection` objects (prompts.ts:491-555). Each is either:
   - `systemPromptSection(name, compute)` - cached, computed once per session
   - `DANGEROUS_uncachedSystemPromptSection(name, compute, reason)` - recomputed every turn

6. **Dynamic section resolution**: All dynamic sections are resolved via `resolveSystemPromptSections()` (prompts.ts:557-558).

7. **Final assembly**: Returns a `string[]` array with static sections first, boundary marker, then dynamic sections (prompts.ts:560-577):

```
[
  // --- Static (cacheable) ---
  getSimpleIntroSection(),           // Identity + cyber risk instruction
  getSimpleSystemSection(),          // System behavior rules
  getSimpleDoingTasksSection(),      // Coding/task guidelines (conditional)
  getActionsSection(),               // Reversibility/blast radius guidance
  getUsingYourToolsSection(),        // Tool usage instructions
  getSimpleToneAndStyleSection(),    // Tone rules
  getOutputEfficiencySection(),      // Output brevity guidance

  // === BOUNDARY ===
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,    // Cache boundary marker

  // --- Dynamic (per-session/per-turn) ---
  ...resolvedDynamicSections         // Session guidance, memory, env, MCP, etc.
]
```

8. **API layer** (services/api/claude.ts:1361-1379): Before sending to API, the prompt array is:
   - Prefixed with `getCLISyspromptPrefix()` (identity sentence)
   - Run through `splitSysPromptPrefix()` which splits into cache-scoped blocks
   - Wrapped in `TextBlockParam[]` with `cache_control` markers

---

## Builder Functions

### Identity & Framing

**`getCLISyspromptPrefix()`** (system.ts:30-46)
- Returns one of 3 identity strings:
  - `"You are Claude Code, Anthropic's official CLI for Claude."` (default/interactive)
  - `"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."` (non-interactive with appendSystemPrompt = Claude Code preset)
  - `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` (non-interactive without preset)

**`getSimpleIntroSection(outputStyleConfig)`** (prompts.ts:175-184)
- One paragraph: "You are an interactive agent that helps users..."
- Includes `CYBER_RISK_INSTRUCTION` (cyberRiskInstruction.ts:24) - security guardrail about authorized testing vs destructive techniques
- URL generation prohibition

### System Behavior

**`getSimpleSystemSection()`** (prompts.ts:186-197)
- `# System` header with bulleted rules:
  - Output is displayed to user (markdown rendering)
  - Permission mode explanation
  - `<system-reminder>` tag explanation
  - Tool result injection warning
  - Hooks explanation (`getHooksSection()`)
  - Automatic compression/unlimited context note

### Task Execution

**`getSimpleDoingTasksSection()`** (prompts.ts:199-253)
- `# Doing tasks` header
- Software engineering task context
- Code style sub-items (prompts.ts:200-214):
  - No gold-plating, no unnecessary features/comments/error-handling
  - No premature abstractions
  - (ant-only) Comment discipline, verification, false-claims mitigation
- User help sub-items: `/help` and feedback instructions
- Conditionally skipped if `outputStyleConfig.keepCodingInstructions === false`

### Safety

**`getActionsSection()`** (prompts.ts:255-267)
- `# Executing actions with care`
- Long block about reversibility, blast radius, confirmation for risky actions
- Examples: destructive ops, hard-to-reverse ops, shared-state actions
- "Measure twice, cut once" philosophy

### Tool Usage

**`getUsingYourToolsSection(enabledTools)`** (prompts.ts:269-314)
- `# Using your tools`
- Maps dedicated tools vs Bash: Read > cat, Edit > sed, Write > cat heredoc, Glob > find, Grep > grep
- TodoWrite/TaskCreate for work management
- Parallel tool call guidance
- Special REPL mode variant (prompts.ts:277-285)

### Tone & Output

**`getSimpleToneAndStyleSection()`** (prompts.ts:430-442)
- `# Tone and style`
- No emojis, concise responses, file_path:line_number references, owner/repo#123 format
- No colon before tool calls

**`getOutputEfficiencySection()`** (prompts.ts:403-428)
- Two variants:
  - **ant-only** (prompts.ts:404-414): `# Communicating with the user` - detailed writing guidance for flowing prose, inverted pyramid, no fragments
  - **external** (prompts.ts:416-428): `# Output efficiency` - "Go straight to the point", lead with answer, skip filler

### Session-Specific

**`getSessionSpecificGuidanceSection(enabledTools, skillToolCommands)`** (prompts.ts:352-400)
- `# Session-specific guidance`
- Placed AFTER the dynamic boundary (cache-busting is acceptable)
- Conditionally includes:
  - AskUserQuestion guidance
  - `! <command>` hint for interactive sessions
  - Agent tool section (fork vs standard)
  - Explore/Plan agent search guidance
  - Skill tool slash-command explanation
  - DiscoverSkills guidance
  - Verification agent contract (ant-only)

### Environment

**`computeSimpleEnvInfo(modelId, additionalWorkingDirectories)`** (prompts.ts:651-710)
- `# Environment`
- Bulleted list:
  - Primary working directory (CWD)
  - Worktree flag
  - Git repo status
  - Additional working directories
  - Platform, shell, OS version
  - Model name + ID
  - Knowledge cutoff date
  - Claude model family reference (opus/sonnet/haiku IDs)
  - Claude Code availability note
  - Fast mode explanation

**`computeEnvInfo()`** (prompts.ts:606-649) - Older XML-wrapped variant used by `enhanceSystemPromptWithEnvDetails`

### CLAUDE.md / Memory

**`getUserContext()`** (context.ts:155-189) - Memoized, loads once per session:
- Calls `getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))` (claudemd.ts:1153)
- CLAUDE.md loading order (claudemd.ts:1-26):
  1. Managed memory (`/etc/claude-code/CLAUDE.md`) - global admin instructions
  2. User memory (`~/.claude/CLAUDE.md`) - private global instructions
  3. Project memory (`CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`) - checked into codebase
  4. Local memory (`CLAUDE.local.md`) - private project-specific
- Files closer to CWD have higher priority (loaded later in array)
- Each file wrapped with: `Contents of <path> (<description>):\n\n<content>`
- Prepended with: `"Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written."` (claudemd.ts:89-90)
- Supports `@include` directives (claudemd.ts:18-25)
- Max 40,000 chars per file (claudemd.ts:92)
- Can be disabled via `CLAUDE_CODE_DISABLE_CLAUDE_MDS` env var

**`getSystemContext()`** (context.ts:116-150) - Memoized, loads once per session:
- Git status snapshot (branch, main branch, git user, short status, recent 5 commits)
- Status truncated at 2000 chars (context.ts:20)

**`loadMemoryPrompt()`** (memdir.ts:419+) - Auto-memory / persistent memory system
- Registered as cached dynamic section `'memory'` (prompts.ts:495)

### MCP Instructions

**`getMcpInstructionsSection(mcpClients)`** (prompts.ts:160-165 + 579-604)
- `# MCP Server Instructions`
- Connected MCP servers with instructions get `## ServerName\n<instructions>` blocks
- Registered as `DANGEROUS_uncachedSystemPromptSection` because MCP servers connect/disconnect between turns (prompts.ts:513-519)

### Other Dynamic Sections

**`getLanguageSection(languagePreference)`** (prompts.ts:142-148)
- `# Language` - "Always respond in {language}"

**`getOutputStyleSection(outputStyleConfig)`** (prompts.ts:151-158)
- `# Output Style: {name}\n{prompt}`

**`getScratchpadInstructions()`** (prompts.ts:797-819)
- `# Scratchpad Directory` - session-specific temp directory

**`getFunctionResultClearingSection(model)`** (prompts.ts:821-839)
- `# Function Result Clearing` - tells model old results will be cleared

---

## System Prompt Layers (3-level architecture)

### Level 1: Static / Cross-Org Cacheable (before SYSTEM_PROMPT_DYNAMIC_BOUNDARY)

Content that is identical across all users and sessions. Gets `cacheScope: 'global'` in the API call.

| Section | Function | prompts.ts line |
|---------|----------|-----------------|
| Identity | `getSimpleIntroSection()` | 562 |
| System rules | `getSimpleSystemSection()` | 563 |
| Coding tasks | `getSimpleDoingTasksSection()` | 564-567 |
| Action safety | `getActionsSection()` | 568 |
| Tool usage | `getUsingYourToolsSection()` | 569 |
| Tone/style | `getSimpleToneAndStyleSection()` | 570 |
| Output efficiency | `getOutputEfficiencySection()` | 571 |

### Level 2: Dynamic Per-Session (cached via `systemPromptSection`)

Computed once per session, cached until `/clear` or `/compact`. Placed after the boundary marker.

| Section name | What it contains |
|-------------|------------------|
| `session_guidance` | Agent tool guidance, skill commands, verification |
| `memory` | Auto-memory / persistent memory prompt |
| `ant_model_override` | Ant-only model override suffix |
| `env_info_simple` | Environment block (CWD, platform, model, etc.) |
| `language` | Language preference |
| `output_style` | Output style prompt (Explanatory, Learning, custom) |
| `scratchpad` | Scratchpad directory instructions |
| `frc` | Function result clearing instructions |
| `summarize_tool_results` | "Write down important info" reminder |
| `numeric_length_anchors` | (ant-only) Word count limits |
| `token_budget` | (feature-gated) Token budget instructions |
| `brief` | (feature-gated) Brief/proactive section |

### Level 3: Dynamic Per-Turn (DANGEROUS_uncachedSystemPromptSection)

Recomputed every turn. Breaks prompt cache when value changes.

| Section name | Why uncached |
|-------------|--------------|
| `mcp_instructions` | MCP servers connect/disconnect between turns |

### The SYSTEM_PROMPT_DYNAMIC_BOUNDARY Marker

Defined at prompts.ts:114: `'__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'`

- Inserted into the prompt array between static and dynamic sections (prompts.ts:573)
- Only inserted when `shouldUseGlobalCacheScope()` returns true
- `splitSysPromptPrefix()` (api.ts:321-401) uses this marker to split the prompt into cache-scoped blocks:
  - **Attribution header**: `cacheScope: null` (not cached)
  - **CLI prefix sentence**: `cacheScope: null` or `'org'`
  - **Static content** (before boundary): `cacheScope: 'global'` - shared across all orgs
  - **Dynamic content** (after boundary): `cacheScope: null` - not cached at global level

---

## Tool Definition System

### Tool Registration (tools.ts)

All tools are imported and assembled in `src/tools.ts`. The main tool list includes:

- **Core**: BashTool, FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool, NotebookEditTool
- **Agent**: AgentTool, SkillTool, SendMessageTool, TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool
- **Web**: WebFetchTool, WebSearchTool
- **Planning**: EnterPlanModeTool, ExitPlanModeV2Tool, TodoWriteTool
- **Session**: AskUserQuestionTool, TaskStopTool, TaskOutputTool
- **Search**: ToolSearchTool (deferred tool loading)
- **Worktree**: EnterWorktreeTool, ExitWorktreeTool
- **MCP**: ListMcpResourcesTool, ReadMcpResourceTool (+ dynamic MCP tools)
- **Feature-gated**: SleepTool (proactive), BriefTool (kairos), REPLTool (ant), CronTools (triggers)

### Tool-to-API Schema (api.ts:119+)

`toolToAPISchema()` converts each Tool to the API's `BetaToolUnion` format:
- `name`, `description` (from `tool.prompt()`)
- `input_schema` (JSON Schema for parameters)
- Optional: `strict`, `eager_input_streaming`, `defer_loading` (for ToolSearch)
- Optional: `cache_control` with scope

### Agent-Disallowed Tools (tools.ts constants)

**`ALL_AGENT_DISALLOWED_TOOLS`** (tools.ts:36-46): Tools blocked from ALL sub-agents:
- TaskOutputTool, ExitPlanModeTool, EnterPlanModeTool, AskUserQuestionTool, TaskStopTool
- AgentTool (except for ant users who get nested agents)

**`ASYNC_AGENT_ALLOWED_TOOLS`** (tools.ts:55-71): Whitelist for async agents:
- FileRead, WebSearch, TodoWrite, Grep, WebFetch, Glob, Shell tools, FileEdit, FileWrite, NotebookEdit, SkillTool, SyntheticOutput, ToolSearch, Worktree tools

**`COORDINATOR_MODE_ALLOWED_TOOLS`** (tools.ts:107-112): Minimal set for coordinator:
- AgentTool, TaskStopTool, SendMessageTool, SyntheticOutputTool

### Tool Limits (toolLimits.ts)

- `DEFAULT_MAX_RESULT_SIZE_CHARS`: 50,000 chars per tool result
- `MAX_TOOL_RESULT_TOKENS`: 100,000 tokens
- `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`: 200,000 chars per message (all parallel results combined)
- `TOOL_SUMMARY_MAX_LENGTH`: 50 chars for compact display

---

## Sub-Agent Prompt System

### Agent Definition Types (loadAgentsDir.ts:105-165)

```typescript
type BaseAgentDefinition = {
  agentType: string             // Identifier (e.g., "Plan", "Explore")
  whenToUse: string             // Description shown to the model
  tools?: string[]              // Allowlist (["*"] = all)
  disallowedTools?: string[]    // Denylist
  skills?: string[]             // Preloaded skills
  mcpServers?: AgentMcpServerSpec[]
  hooks?: HooksSettings
  color?: AgentColorName
  model?: string                // "inherit" or model ID
  effort?: EffortValue
  permissionMode?: PermissionMode
  maxTurns?: number
  background?: boolean
  initialPrompt?: string
  memory?: AgentMemoryScope     // "user" | "project" | "local"
  isolation?: "worktree" | "remote"
  omitClaudeMd?: boolean        // Skip CLAUDE.md for read-only agents
}

type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: "built-in"
  getSystemPrompt: (params) => string   // Dynamic prompt generator
}

type CustomAgentDefinition = BaseAgentDefinition & {
  source: SettingSource          // "userSettings" | "projectSettings" | etc.
  getSystemPrompt: () => string
}

type PluginAgentDefinition = BaseAgentDefinition & {
  source: "plugin"
  plugin: string
  getSystemPrompt: () => string
}
```

### Built-In Agents (builtInAgents.ts:22-72)

**Always included:**
- `general-purpose` - Default agent for complex tasks
- `statusline-setup` - Statusline configuration helper

**Conditionally included:**
- `Explore` + `Plan` - When `areExplorePlanAgentsEnabled()` (feature flag + GrowthBook)
- `claude-code-guide` - For non-SDK entrypoints
- `verification` - When feature flag + GrowthBook `tengu_hive_evidence`

Can be fully disabled via `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` env var.

### General-Purpose Agent (generalPurposeAgent.ts)

- **agentType**: `"general-purpose"`
- **tools**: `["*"]` (all tools)
- **model**: omitted (uses default subagent model)
- **System prompt**: Generic agent + guidelines for searching/analyzing codebases
- **Key text**: "Complete the task fully -- don't gold-plate, but don't leave it half-done."

### Explore Agent (exploreAgent.ts)

- **agentType**: `"Explore"`
- **model**: `"haiku"` (external) or `"inherit"` (ant)
- **omitClaudeMd**: `true` (saves tokens)
- **disallowedTools**: AgentTool, ExitPlanMode, FileEdit, FileWrite, NotebookEdit
- **System prompt**: Read-only file search specialist
  - Explicitly prohibited from creating/modifying files
  - Emphasis on efficiency and parallel tool calls
  - Bash restricted to read-only commands only
- **ONE_SHOT**: Listed in `ONE_SHOT_BUILTIN_AGENT_TYPES` (no SendMessage continuation)

### Plan Agent (planAgent.ts)

- **agentType**: `"Plan"`
- **model**: `"inherit"`
- **omitClaudeMd**: `true`
- **tools**: Same as Explore (read-only)
- **disallowedTools**: Same as Explore + AgentTool
- **System prompt**: Software architect for designing implementation plans
  - READ-ONLY MODE enforced
  - 4-step process: Understand -> Explore -> Design -> Detail
  - Required output: "Critical Files for Implementation" list
- **ONE_SHOT**: Listed in `ONE_SHOT_BUILTIN_AGENT_TYPES`

### Verification Agent (verificationAgent.ts)

- **agentType**: `"verification"`
- **model**: `"inherit"`
- **background**: `true`
- **color**: `"red"`
- **disallowedTools**: AgentTool, ExitPlanMode, FileEdit, FileWrite, NotebookEdit
- **System prompt**: Adversarial verification specialist
  - Cannot modify project files (can write to /tmp)
  - Strategy matrix per change type (frontend, backend, CLI, infra, etc.)
  - Required steps: read CLAUDE.md, build, test suite, linters
  - Anti-rationalization section ("You will feel the urge to skip checks")
  - Required output format: `### Check` blocks with Command run / Output observed / Result
  - Must end with `VERDICT: PASS | FAIL | PARTIAL`
- **criticalSystemReminder_EXPERIMENTAL**: Re-injected every turn as reminder

### Agent Prompt Assembly (AgentTool prompt.ts:66-287)

The AgentTool's own tool description (`getPrompt()`) includes:
- Static description of what the tool does
- Agent listing (inline or via attachment depending on feature flag)
- Fork semantics section (when fork subagent enabled)
- "Writing the prompt" guidance
- Usage examples (fork-style or standard-style)
- Usage notes (descriptions, background, worktree, remote)
- When NOT to use guidance (unless fork mode)

**Agent list injection** (prompt.ts:58-64): Can be either:
- **Inline**: Agent descriptions embedded in tool description (default)
- **Attachment**: Injected as `agent_listing_delta` system-reminder message (reduces cache busting)

### Sub-Agent System Prompt Enhancement (prompts.ts:760-791)

`enhanceSystemPromptWithEnvDetails()` appends to any agent's system prompt:
- Notes about CWD reset, absolute paths, emoji prohibition, no colon before tool calls
- DiscoverSkills guidance (if enabled)
- Full environment info via `computeEnvInfo()`

### Custom Agents from `.claude/agents/*.md`

Loaded by `loadAgentsDir.ts`. Supports:
- **Markdown** with YAML frontmatter: description, tools, disallowedTools, model, effort, permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt, memory, background, isolation
- **JSON** format: `agents.json` with same fields
- Sources: userSettings, projectSettings, localSettings, flagSettings, policySettings, plugin
- Priority order (later overrides): built-in < plugin < user < project < flag < managed

---

## Settings and Configuration

### Settings Sources (settings/constants.ts:7-22)

Priority order (later overrides earlier):
1. `userSettings` - `~/.claude/settings.json`
2. `projectSettings` - `.claude/settings.json`
3. `localSettings` - `.claude/settings.local.json` (gitignored)
4. `flagSettings` - `--settings` CLI flag
5. `policySettings` - `managed-settings.json` or remote API (always loaded)

### Settings Schema (settings/types.ts:255+)

Key fields relevant to prompt assembly:

```typescript
{
  model?: string                    // Override default model
  availableModels?: string[]        // Enterprise model allowlist
  modelOverrides?: Record<string, string>  // Model ID remapping
  permissions?: {
    allow?: PermissionRule[]
    deny?: PermissionRule[]
    ask?: PermissionRule[]
    defaultMode?: PermissionMode
    additionalDirectories?: string[]
    disableBypassPermissionsMode?: "disable"
  }
  hooks?: HooksSettings             // Pre/post tool execution hooks
  env?: Record<string, string>      // Environment variables
  outputStyle?: string              // "default" | "Explanatory" | "Learning" | custom
  language?: string                 // Response language preference
  includeGitInstructions?: boolean  // Include git workflow in prompt (default: true)
  effortLevel?: "low" | "medium" | "high" | "max"
  fastMode?: boolean
  alwaysThinkingEnabled?: boolean
  agent?: string                    // Main thread agent name
  enabledPlugins?: Record<string, boolean | string[]>
  statusLine?: { type: "command", command: string }
  worktree?: { symlinkDirectories?: string[], sparsePaths?: string[] }
}
```

### Permission Modes (types/permissions.ts)

External modes (all users):
- **`default`** - Standard mode, prompts for each tool use
- **`plan`** - Read-only planning mode
- **`acceptEdits`** - Auto-accepts file edits
- **`bypassPermissions`** - Skips all permission prompts
- **`dontAsk`** - Never prompt (auto-deny unknown)

Internal modes (ant-only):
- **`auto`** - Uses classifier to auto-approve safe operations

Mode config (PermissionMode.ts:42-91) includes title, shortTitle, symbol, color, and external mapping.

### Output Styles (outputStyles.ts)

Built-in styles:
- **`default`**: null (no custom prompt)
- **`Explanatory`**: Adds `Insight` blocks before/after code, `keepCodingInstructions: true`
- **`Learning`**: Adds "Learn by Doing" interactive blocks requesting user input, `keepCodingInstructions: true`

Custom styles loaded from:
- `~/.claude/output-styles/` (user)
- `.claude/output-styles/` (project)
- Plugins (with optional `forceForPlugin` auto-apply)
- Managed settings

When `keepCodingInstructions` is false, `getSimpleDoingTasksSection()` is skipped entirely.

---

## Key Types and Interfaces

### SystemPromptSection (systemPromptSections.ts:8-14)
```typescript
type SystemPromptSection = {
  name: string
  compute: () => string | null | Promise<string | null>
  cacheBreak: boolean   // false = cached once, true = recomputed every turn
}
```

### SystemPromptBlock (api.ts, inferred)
```typescript
type SystemPromptBlock = {
  text: string
  cacheScope: 'global' | 'org' | null
}
```

### CLISyspromptPrefix (system.ts:20)
```typescript
type CLISyspromptPrefix =
  | "You are Claude Code, Anthropic's official CLI for Claude."
  | "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."
  | "You are a Claude agent, built on Anthropic's Claude Agent SDK."
```

### OutputStyleConfig (outputStyles.ts:11-23)
```typescript
type OutputStyleConfig = {
  name: string
  description: string
  prompt: string
  source: SettingSource | "built-in" | "plugin"
  keepCodingInstructions?: boolean
  forceForPlugin?: boolean
}
```

### AgentDefinition (loadAgentsDir.ts:162-165)
```typescript
type AgentDefinition =
  | BuiltInAgentDefinition    // source: "built-in", getSystemPrompt with params
  | CustomAgentDefinition     // source: SettingSource, getSystemPrompt no params
  | PluginAgentDefinition     // source: "plugin", plugin name
```

### PermissionMode (types/permissions.ts:29)
```typescript
type PermissionMode = "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan" | "auto" | "bubble"
```

### Key Constants
- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`: `"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"` (prompts.ts:114)
- `DEFAULT_AGENT_PROMPT`: Generic agent prompt text (prompts.ts:758)
- `FRONTIER_MODEL_NAME`: `"Claude Opus 4.6"` (prompts.ts:118)
- `MAX_MEMORY_CHARACTER_COUNT`: 40,000 (claudemd.ts:92)
- `MAX_STATUS_CHARS`: 2,000 for git status truncation (context.ts:20)
- `MEMORY_INSTRUCTION_PROMPT`: Override notice prepended to CLAUDE.md content (claudemd.ts:89-90)
- `CYBER_RISK_INSTRUCTION`: Security guardrail text (cyberRiskInstruction.ts:24)
