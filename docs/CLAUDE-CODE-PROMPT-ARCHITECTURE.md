# Claude Code System Prompt Architecture

Technical reference for the 3-level system prompt architecture used by the Claude Code CLI. This document is based on analysis of the leaked source code (v2.1.88) and multiple independent reverse-engineering efforts.

Relevant to the claude-code-gui project because our sidecar process interfaces with the Agent SDK, which assembles and sends these prompts to the Anthropic API.

---

## Overview

Claude Code does not use a single monolithic system prompt. It dynamically assembles the prompt from **~110 individual prompt strings** organized into 3 architectural levels, separated by a physical boundary marker for cache optimization.

```
┌─────────────────────────────────────────────────────┐
│  Level 1 — Global Cached (Static)                   │
│  ~269 tokens base + ~14-17K tokens tool definitions  │
│  Cached across all users/organizations               │
├─────────────────────────────────────────────────────┤
│  __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__                  │
├─────────────────────────────────────────────────────┤
│  Level 2 — Dynamic Per-Session                       │
│  CLAUDE.md files, MCP servers, environment, agents   │
│  Stable within a session, varies between sessions    │
├─────────────────────────────────────────────────────┤
│  Level 3 — Real-Time Per-Turn                        │
│  Conversation history, system reminders, memory      │
│  Changes every turn                                  │
└─────────────────────────────────────────────────────┘
```

## Level 1 — Global Cached Layer

**Purpose**: Core behavioral instructions and tool definitions. Identical for all users and sessions.

**Contents**:

- **Identity and safety rules** (~269 tokens): Who Claude is, what it can/cannot do, OWASP awareness, security testing boundaries
- **Permission configuration**: Read-only tools (always allowed), write operations (need approval), destructive operations (highlighted warnings)
- **Code style rules**: Prefer editing over creating files, no unnecessary abstractions, no speculative features, conventional commits
- **Tool preferences**: Dedicated tools over Bash equivalents (Read not cat, Edit not sed, Glob not find, Grep not grep)
- **Tone directives**: Concise, no emoji unless asked, no time estimates, lead with action not reasoning
- **Tool definitions** (~14-17K tokens): Full JSON schema for each of the 23-24 built-in tools

**Caching**: This entire block is eligible for Anthropic's prompt caching — computed once and reused across all users globally. This is a significant cost optimization.

### Built-in Tools

| Category | Tools |
|----------|-------|
| File read | Read, Glob, Grep |
| File write | Edit, Write, Replace |
| Execution | Bash |
| Sub-agents | dispatch_agent (Plan, Explore, Task, custom) |
| Parallel execution | BatchTool |
| Web | WebFetch, WebSearch |
| Notebooks | NotebookEdit |
| Task management | TodoWrite |

Each tool definition includes a name, detailed description with usage instructions, and a full JSON parameter schema.

## Level 2 — Dynamic Per-Session

**Purpose**: User-specific and project-specific context. Changes between sessions but stable within one.

**Contents**:

- **CLAUDE.md hierarchy** (3 scopes):
  - Global: `~/.claude/CLAUDE.md` — user preferences, cross-project rules
  - Project root: `./CLAUDE.md` — project-specific instructions, tech stack, conventions
  - Path-scoped: `.claude/rules/*.md` — directory-specific overrides
- **MCP server instructions**: Any connected Model Context Protocol servers and their tool descriptions
- **Environment snapshot**:
  - Working directory path
  - Git repository status (branch, recent commits, dirty files)
  - Platform (win32, darwin, linux)
  - Shell (bash, zsh, powershell)
  - OS version
  - Current date
  - Model identifier (claude-sonnet-4-6, claude-opus-4-6, etc.)
- **Available sub-agents**: Plan, Explore, Task, plus custom agents from `.claude/agents/*.md`

### The Dynamic Boundary Marker

The source uses a marker `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` to physically split the system prompt:

- Everything **above** the boundary: static, globally cached
- Everything **below** the boundary: per-session, recomputed

Functions that modify the dynamic section are annotated as `DANGEROUS_uncachedSystemPromptSection()` to alert engineers that their changes will break cache and increase cost.

The codebase tracks **14 cache-break vectors** and implements **"sticky latches"** to prevent mode toggles (e.g., permission level changes) from invalidating the cached prompt context mid-session.

## Level 3 — Real-Time Per-Turn

**Purpose**: State that changes on every conversation turn.

**Contents**:

- **Conversation history**: User messages, assistant responses, tool calls and results
- **Context compaction**: When context approaches limits, older turns are summarized
- **System reminders**: Injected at specific points during conversation (not tied to any particular message)
- **Memory contents**: First 200 lines of `MEMORY.md` index file, loaded every turn
- **Hook feedback**: Output from user-configured pre/post hooks

### Context Compaction

Five distinct compaction strategies handle context overflow:

1. **Index layer** (always loaded): Lightweight pointers, ~150 characters per entry
2. **Topic files** (loaded on demand): Actual knowledge, retrieved when relevant
3. **Transcripts** (grep-only): Historical records searched but never injected into context

## Prompt Assembly

The system prompt is assembled from **~15 composable builder functions** in `src/constants/prompts.ts`:

- **~50+ core system prompts**: Behavioral instructions
- **~40 system reminders**: Context-specific notifications (e.g., "file was modified externally")
- **~25 agent prompts**: Sub-agent instructions (Plan, Explore, Task, security review)
- **~25 data templates**: API/SDK references, documentation snippets

Each section is an independent unit that can be measured, tuned, A/B tested, and shipped separately.

## Multi-Model Strategy

Claude Code uses different models for different tasks within a single session:

| Task | Model |
|------|-------|
| Main reasoning and code generation | Sonnet / Opus |
| Bash command security screening | Haiku |
| File path extraction from commands | Haiku |
| Context summarization during compaction | Haiku |

## Anti-Distillation Mechanisms

The source reveals prompt-level security features:

- **Fake Tools**: When `ANTI_DISTILLATION_CC` flag is enabled, decoy tool definitions are silently injected into the system prompt. If competitors record API traffic to train their models, the fake tools pollute their training data.
- **Connector-text summarization**: Buffers assistant responses between tool calls, summarizes them with cryptographic signatures, obscuring the full reasoning chain from observers.
- **Undercover Mode** (`undercover.ts`): When working on public repositories, instructs Claude to never mention internal codenames, Slack channels, repo names, or "Claude Code" in commit messages. Dead-code-eliminated in external builds.

## Token Budget

| Component | Approximate Tokens |
|-----------|-------------------|
| Base system prompt | ~269 |
| Tool definitions (23-24 tools) | ~14,000 - 17,600 |
| CLAUDE.md (typical project) | ~500 - 2,000 |
| Environment snapshot | ~200 - 500 |
| MCP server instructions | varies |
| **Total system prompt** | **~15,000 - 20,000** |

The remaining context window is available for conversation history, tool results, and the model's reasoning.

## Optimization Details from A/B Testing

Internal A/B testing results embedded in source comments:

- **~1.2% output token reduction** from explicit constraints vs. vague "be concise" directives
- Production builds enforce measurable boundaries: text between tool calls limited to **25 words**, final responses limited to **100 words**
- The base prompt is deliberately minimal (~269 tokens) — everything else loads conditionally (progressive disclosure)

## Relevance to claude-code-gui

Our sidecar process (`sidecar/sidecar.js`) uses the Agent SDK which handles prompt assembly internally. Key implications:

1. **We don't control Level 1**: The SDK assembles the cached system prompt. We can't modify tool definitions or base instructions.
2. **We influence Level 2**: Through the `systemPrompt` parameter in SDK queries, we inject our GUI-specific instructions (tab context, permission mode, etc.). These land in the dynamic section below the boundary.
3. **We influence Level 3**: Through conversation messages passed to the SDK.
4. **Custom agents**: Our `.claude/agents/*.md` files are picked up by the SDK and included in Level 2 as available sub-agents.

## Sources

- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — Comprehensive extraction of all prompt parts, updated per Claude Code version
- [Engineer's Codex — Diving into Claude Code's Source Code Leak](https://read.engineerscodex.com/p/diving-into-claude-codes-source-code) — Prompt cache boundary pattern, context compaction, tool architecture
- [Alex Kim — The Claude Code Source Leak](https://alex000kim.com/posts/2026-03-31-claude-code-source-leak/) — Anti-distillation mechanisms, undercover mode, cache-break vectors
- [Sabrina — Comprehensive Analysis of Claude Code Source Leak](https://www.sabrina.dev/p/claude-code-source-leak-analysis) — Token optimization, A/B testing results, composable prompt construction
- [Kir Shatrov — Reverse engineering Claude Code](https://kirshatrov.com/posts/claude-code-internals) — Tool definitions, security screening, model segmentation
- [Particula — 7 Agent Architecture Lessons](https://particula.tech/blog/claude-code-source-leak-agent-architecture-lessons) — SYSTEM_PROMPT_DYNAMIC_BOUNDARY as cost optimization pattern
