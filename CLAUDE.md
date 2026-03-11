# Claude Code Launcher

A Windows-only Tauri 2 desktop app for selecting and launching Claude Code CLI sessions in tabbed terminals.

## Entry Point

Run via `cargo tauri dev` (development) or build with `cargo tauri build`.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite (in `app/`)
- **Backend**: Rust + Tauri 2 (in `app/src-tauri/`)
- **Terminal**: xterm.js with WebGL renderer
- **Theme**: Catppuccin Mocha (dark-only)

## Key Paths

- `app/src/` — React frontend source
- `app/src/components/` — TabBar, Terminal, ProjectList, StatusBar, NewTabPage
- `app/src/hooks/` — useTabManager, useProjects, usePty
- `app/src/contexts/` — ProjectsContext (shared project state)
- `app/src-tauri/src/` — Rust backend (PTY management, project scanning, settings)

## Architecture

### Frontend

- `App.tsx` — Tab orchestration, global keyboard shortcuts, close confirmation
- `TabBar.tsx` — Tab bar with drag region, output indicator, exit status
- `Terminal.tsx` — xterm.js wrapper with WebGL, PTY communication via Tauri Channel
- `NewTabPage.tsx` — Project picker with keyboard navigation, settings cycling
- `ProjectList.tsx` — Scrollable project list with branch/dirty/CLAUDE.md indicators
- `StatusBar.tsx` — Model, effort, sort, permissions display

### Hooks

- `useTabManager` — Tab lifecycle (add/close/update/activate/next/prev) with stable callbacks via refs
- `useProjects` — Settings + usage loading, project scanning, filtering/sorting via Tauri IPC
- `usePty` — PTY spawn/write/resize/kill/heartbeat via Tauri Channel

### State

- `ProjectsContext` wraps `useProjects` so all NewTabPage instances share state
- Tab state is managed in App via `useTabManager` (useState-based)
- Terminal uses refs for high-frequency PTY callbacks (not React state)

## Models Available (Tab to cycle)

sonnet / opus / haiku / sonnet [1M] / opus [1M]

Model IDs: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`,
`claude-sonnet-4-6[1m]`, `claude-opus-4-6[1m]`

## Keyboard Shortcuts

- **Ctrl+T**: New tab
- **Ctrl+F4**: Close tab
- **Ctrl+Tab / Ctrl+Shift+Tab**: Next/previous tab
- **Tab**: Cycle model (in project picker)
- **F2**: Cycle effort level
- **F3**: Cycle sort order
- **F4**: Toggle skip-permissions
- **F6**: Open project in Explorer
- **Enter**: Launch selected project
- **Esc**: Clear filter / close tab
- **Type to filter**: Case-insensitive project search
- **Arrow keys / PageUp / PageDown / Home / End**: Navigate project list

## Design Tokens

CSS custom properties in `App.css` `:root`:
- Colors: `--bg`, `--surface`, `--mantle`, `--text`, `--text-dim`, `--accent`, `--red`, `--green`, `--yellow`
- Spacing: `--space-1` (4px) through `--space-4` (16px)
- Typography: `--text-xs` (10px) through `--text-xl` (18px)
- Radii: `--radius-sm` (4px), `--radius-md` (6px)
- Overlays: `--hover-overlay`, `--hover-overlay-subtle`

## Important Constraints

- Windows-only. Do not add cross-platform abstractions unless asked.
- Default project directory is `D:\Projects` but overridable via settings.
- Multiple project directories supported; persisted in settings via Rust backend.
- All components use `React.memo` for re-render control.
- Terminal callbacks use refs to avoid stale closures in high-frequency PTY events.
- PTY sessions are killed on tab close via `killSession()`.
