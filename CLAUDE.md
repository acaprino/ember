# Figtree

A Windows-only Tauri 2 desktop app for selecting and launching Claude Code Agent SDK sessions in a tabbed interface.

## Quick Start

- Development: `cargo tauri dev` (or `dev.bat`)
- Build: `cargo tauri build`
- DevTools: `cargo tauri dev --features devtools`
- Frontend dir: `cd app && npm install`

## Tech Stack

- **Frontend**: React 19 + TypeScript 5 + Vite 6 (in `app/`)
- **Backend**: Rust + Tauri 2 (in `app/src-tauri/`)
- **Sidecar**: Node.js process running Agent SDK, bridged via JSON-RPC (in `sidecar/`)
- **Chat UI**: React chat interface with react-markdown, react-syntax-highlighter, remark-gfm for rendering structured agent messages
- **Themes**: 10 dark themes (Catppuccin Mocha default), selectable via Ctrl+, settings

## Key Paths

- `app/src/components/` - TabBar, TabSidebar, TitleBar, ChatView, ProjectList, InfoStrip, SessionConfig, NewTabPage, AboutPage, UsagePage, SystemPromptPage, SessionBrowser, SessionPanel, Modal, ErrorBoundary, AsciiLogo, FolderTree, SegmentedControl, ShortcutsOverlay, GsdPrimitives
- `app/src/components/chat/` - ChatInput, MessageBubble, ToolCard, PermissionCard, ThinkingBlock, ThinkingIndicator, ThinkingPanel, ResultBar, RightSidebar, MinimapPanel, BookmarkPanel, TodoPanel, AttachmentChip, CommandMenu, MentionMenu
- `app/src/components/modals/` - SettingsModal, CreateProjectModal, LabelProjectModal, QuickLaunchModal
- `app/src/hooks/` - useTabManager, useProjects, useAgentSession
- `app/src/utils/sanitizeInput.ts` - Input sanitization
- `app/src/contexts/ProjectsContext.tsx` - Shared project state
- `app/src/themes.ts` - Theme application to CSS variables
- `app/src/types.ts` - Type definitions, model/effort/sort/theme constants, AgentEvent types
- `app/src-tauri/src/` - Rust backend: main.rs, sidecar.rs, projects.rs, commands.rs, prompts.rs, usage_stats.rs, marketplace.rs, autocomplete.rs, logging.rs, watcher.rs
- `sidecar/sidecar.js` - Node.js process running Agent SDK, communicates with Rust via JSON-lines

For detailed architecture, IPC protocol, and development guide, see `docs/TECHNICAL.md`.

## Tool

- Claude Code (Agent SDK via Node.js sidecar process)

## Models (Tab to cycle)

sonnet / opus / haiku / sonnet [1M] / opus [1M]

## Keyboard Shortcuts

### Global (App.tsx)
- **Ctrl+T**: New tab
- **Ctrl+F4**: Close tab
- **Ctrl+Tab / Ctrl+Shift+Tab**: Next/previous tab
- **Ctrl+1-9**: Switch to tab by number
- **F1**: Toggle keyboard shortcuts overlay
- **F12**: Toggle about tab
- **Ctrl+U**: Toggle usage/stats tab
- **Ctrl+Shift+P**: Toggle system prompts tab
- **Ctrl+Shift+H**: Toggle sessions browser tab
- **Ctrl+Shift+S**: Toggle session panel

### Project Picker (NewTabPage active, no modal open)
- **Tab**: Cycle permission mode (plan/accept edits/skip all)
- **F2**: Cycle effort level (high/medium/low)
- **F3**: Cycle sort order (alpha/last used/most used)
- **F4**: Cycle model
- **F5**: Create new project
- **F6**: Open project in Explorer
- **F8**: Label selected project
- **F10**: Quick launch (arbitrary directory)
- **Ctrl+,**: Open settings (themes, font, directories, behavior)
- **Enter**: Launch selected project
- **Esc**: Clear filter / close tab
- **Backspace**: Delete last filter character
- **Type to filter**: Case-insensitive project search
- **Arrow keys / PageUp / PageDown / Home / End**: Navigate project list

### Agent Tab (ChatView.tsx active)
- **Ctrl+C**: Copy selection (or send interrupt if no selection)
- **Ctrl+V**: Paste (text or image path)

## Design Tokens

CSS custom properties in `App.css` `:root`:
- Colors: `--bg`, `--surface`, `--mantle`, `--crust`, `--text`, `--text-dim`, `--overlay0`, `--overlay1`, `--accent`, `--red`, `--green`, `--yellow`
- Spacing: `--space-0` (0) through `--space-12` (48px)
- Typography: `--text-xs` (10px) through `--text-xl` (18px)
- Radii: `--radius-sm` (4px), `--radius-md` (6px)
- Overlays: `--hover-overlay`, `--hover-overlay-subtle`, `--backdrop`
- Z-index: `--z-resize`, `--z-modal`
- Layout: `--tab-height`, `--info-strip-height`, `--title-bar-height`, `--sidebar-width`, `--sidebar-min-width`, `--sidebar-max-width`, `--session-panel-width`, `--sidebar-handle-width`
- Shadows: `--shadow-modal`
- Font: `--font-mono`, `--chat-font-family`, `--chat-font-size`

## Architecture Notes

### Rust Backend (sidecar.rs)
- JSON-RPC bridge to Node.js sidecar running @anthropic-ai/claude-agent-sdk. Commands/events flow as JSON-lines over stdin/stdout.
- Win32 Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) ensures the entire sidecar process tree is killed on app close — not just the direct `node.exe`.
- `autocomplete.rs` handles file-path completion. SDK-based autocomplete uses `@anthropic-ai/sdk` directly in `sidecar/sidecar.js` with OAuth fallback from `~/.claude/.credentials.json`.

### React Frontend
- Most components use `React.memo` for re-render control.
- `hasNewOutput` updates are guarded — the tab array is only recreated once per new-output burst, not on every chunk.
- MinimapPanel uses incremental canvas rendering with cached theme colors, separating viewport updates from full redraws.
- `input_style` setting supports "chat" (default) and "terminal" input modes.

### CSS Architecture
- All colors use `color-mix()` with CSS variables for theme adaptability — no hardcoded rgba values.
- Font family inherits from `--font-mono` on `html, body`. Component-level declarations removed.
- Modals have enter animations (backdrop fade + slide-up). Buttons have `:active` pressed states.
- `will-change` is never used statically — the browser handles compositing for transitions.

## Constraints

- Windows-only. Do not add cross-platform abstractions unless asked.
- Agent sessions are killed on tab close via `killAgent()`.
- Hidden directories (starting with `.`) are excluded from project scanning.
- Default project directory is `D:\Projects`, overridable via settings (multiple directories supported).
- Environment variable `FIGTREE_PROJECTS_DIR` overrides the default project directory.

## ASCII Logo

- Generated from `icon.png` using https://convertico.com/image-to-ascii/ (30x15)
- Rendered via `AsciiLogo.tsx` component with ANSI RGB color codes
- Displayed on the About page

## Conventions

- Commit messages use conventional commits: `feat:`, `fix:`, `style:`, `perf:`, `docs:`, `refactor:`
- No linter/formatter configured - follow existing code style
- No test framework - manual testing only
- CSS: Use `color-mix(in srgb, var(--token) N%, transparent)` for opacity variants, never hardcoded rgba
- CSS: Do not add `will-change` statically — only add dynamically if profiling shows jank
- CSS: Do not add component-level `font-family` — let elements inherit from body
