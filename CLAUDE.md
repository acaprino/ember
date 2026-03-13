# Ember

A Windows-only Tauri 2 desktop app for selecting and launching Claude Code CLI sessions in tabbed terminals.

## Entry Point

Run via `cargo tauri dev` (development) or build with `cargo tauri build`.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite (in `app/`)
- **Backend**: Rust + Tauri 2 (in `app/src-tauri/`)
- **Terminal**: xterm.js with WebGL renderer
- **Themes**: 8 dark themes (Catppuccin Mocha default), selectable via F9

## Key Paths

- `app/src/` — React frontend source
- `app/src/components/` — TabBar, Terminal, ProjectList, StatusBar, NewTabPage, Modal, ErrorBoundary
- `app/src/hooks/` — useTabManager, useProjects, usePty
- `app/src/contexts/` — ProjectsContext (shared project state)
- `app/src/themes.ts` — Theme application to CSS variables and xterm
- `app/src/types.ts` — Type definitions, model/effort/sort/theme constants
- `app/src-tauri/src/` — Rust backend: main.rs, pty.rs, projects.rs, commands.rs, claude.rs, session.rs, logging.rs

## Architecture

### Frontend

- `App.tsx` — Tab orchestration, global keyboard shortcuts, resize handles
- `TabBar.tsx` — Tab bar with drag region, output indicator, exit status
- `Terminal.tsx` — xterm.js wrapper with WebGL, PTY communication via Tauri Channel, file drag-and-drop
- `NewTabPage.tsx` — Project picker with keyboard navigation, settings cycling, modals
- `ProjectList.tsx` — Scrollable project list with branch/dirty/CLAUDE.md indicators
- `StatusBar.tsx` — Tool, model, effort, sort, permissions, theme, font display + action buttons
- `Modal.tsx` — Reusable modal component
- `ErrorBoundary.tsx` — Wraps Terminal components

### Hooks

- `useTabManager` — Tab lifecycle (add/close/update/activate/next/prev) with stable callbacks via refs; session save/restore across app restarts
- `useProjects` — Settings + usage loading, project scanning, filtering/sorting via Tauri IPC
- `usePty` — PTY spawn/write/resize/kill/heartbeat via Tauri Channel

### State

- `ProjectsContext` wraps `useProjects` so all NewTabPage instances share state
- Tab state is managed in App via `useTabManager` (useState-based)
- Terminal uses refs for high-frequency PTY callbacks (not React state)

## Tools Available (F1 to cycle)

claude / gemini

- `claude` — Claude Code CLI (`@anthropic-ai/claude-code`)
- `gemini` — Gemini CLI (`@google/gemini-cli`); model/effort/perms hidden when selected

## Models Available (Tab to cycle, Claude only)

sonnet / opus / haiku / sonnet [1M] / opus [1M]

Model IDs: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`,
`claude-sonnet-4-6[1m]`, `claude-opus-4-6[1m]`

## Effort Levels (F2 to cycle, Claude only)

high / medium / low

## Sort Orders (F3 to cycle)

alpha / last used / most used

## Keyboard Shortcuts

- **Ctrl+T**: New tab
- **Ctrl+F4**: Close tab
- **Ctrl+Tab / Ctrl+Shift+Tab**: Next/previous tab
- **F1**: Cycle tool (claude/gemini)
- **Tab**: Cycle model (Claude only)
- **F2**: Cycle effort level (Claude only)
- **F3**: Cycle sort order
- **F4**: Toggle skip-permissions
- **F5**: Create new project
- **F6**: Open project in Explorer
- **F7**: Manage project directories
- **F8**: Label selected project
- **F9**: Theme picker
- **F10**: Quick launch (arbitrary directory)
- **F11**: Font settings
- **Enter**: Launch selected project
- **Esc**: Clear filter / close tab
- **Backspace**: Delete last filter character
- **Type to filter**: Case-insensitive project search
- **Arrow keys / PageUp / PageDown / Home / End**: Navigate project list

## Design Tokens

CSS custom properties in `App.css` `:root`:
- Colors: `--bg`, `--surface`, `--mantle`, `--crust`, `--text`, `--text-dim`, `--overlay0`, `--overlay1`, `--accent`, `--red`, `--green`, `--yellow`
- Spacing: `--space-1` (4px) through `--space-12` (48px)
- Typography: `--text-xs` (10px) through `--text-xl` (18px)
- Radii: `--radius-sm` (4px), `--radius-md` (6px)
- Overlays: `--hover-overlay`, `--hover-overlay-subtle`
- Z-index: `--z-resize`, `--z-modal`
- Layout: `--tab-height`

## Important Constraints

- Windows-only. Do not add cross-platform abstractions unless asked.
- Default project directory is `D:\Projects` but overridable via settings.
- Multiple project directories supported; persisted in settings via Rust backend.
- All components use `React.memo` for re-render control.
- Terminal callbacks use refs to avoid stale closures in high-frequency PTY events.
- PTY sessions are killed on tab close via `killSession()`.
- Dropped file paths are validated against safe Windows path characters before writing to PTY.
- Hidden directories (starting with `.`) are excluded from project scanning.
