# Tabbed Claude Launcher — Design Spec

## Overview

Replace the current Python TUI launcher with a Tauri 2 desktop app that supports multiple Claude Code instances running simultaneously in tabs within a single window. The app combines project selection (new-tab page) with embedded terminal emulation (xterm.js + ConPTY).

## Goals

- Run multiple Claude Code CLI instances in parallel, each in its own tab
- Preserve all features of the current Python launcher (project list, filter, model/effort/sort/perms toggles, labels, create project, manage dirs, open in explorer)
- Reuse existing settings and usage JSON files for zero-migration
- Keep the Python launcher functional alongside the new app

## Non-Goals

- Cross-platform support (Windows-only, same as current launcher)
- SSH/remote terminal support
- Split panes within a single tab

## Stack

- **Frontend**: React 19 + TypeScript + xterm.js + xterm-addon-fit + xterm-addon-webgl
- **Backend**: Rust + Tauri 2 + windows-rs (ConPTY) + serde/serde_json + tokio
- **Build**: `npm run tauri build` → standalone `.exe`

## Architecture

### Tab Model

Each tab is in one of two states:
1. **New-tab page** — shows the project list with all launcher controls
2. **Terminal** — running Claude Code instance connected to a ConPTY

The tab bar sits at the top of the window. A "+" button (and Ctrl+T) opens a new tab in new-tab-page state. When the user selects a project and presses Enter, that tab transitions to terminal state and Claude is spawned.

Maximum concurrent terminal tabs: **10**. When the limit is reached, the "+" button and Ctrl+T show a warning instead of opening a new tab. Each Claude instance can consume significant RAM.

### Frontend Components

```
App.tsx
├── TabBar.tsx          — tab strip with close buttons, "+" button, drag reorder
├── Terminal.tsx         — xterm.js wrapper, connects to PTY via IPC events
├── NewTabPage.tsx       — project list + controls (replaces Python TUI)
│   ├── ProjectList.tsx  — filterable, sortable project list
│   └── StatusBar.tsx    — model, effort, sort, perms toggles
```

### Tab Bar Behavior

- Each tab shows: project name (or label) + close button (×)
- Active tab is visually highlighted, inactive tabs are dimmed
- Keyboard shortcuts (see Keyboard Shortcuts section for details):
  - Ctrl+T: new tab
  - Ctrl+F4: close tab (avoids conflict with terminal Ctrl+W readline binding)
  - Ctrl+Tab / Ctrl+Shift+Tab: navigate between tabs
- Indicator dot on tabs with new output while not in focus
- Tab title format: "project-name — model" (e.g., "my-app — opus")
- Drag & drop reorder (v2, not critical for initial release)

### Window Title

The window title reflects the active tab:
- New-tab page active: `Claude Launcher`
- Terminal tab active: `Claude Launcher — {project_name} (+N tabs)` where N is the total number of open terminal tabs minus 1 (omitted if only 1 terminal tab)

### Terminal Behavior

- xterm.js fills all space below the tab bar
- Auto-resize with window via xterm-addon-fit
- Dark theme (colors matching Windows Terminal defaults)
- When Claude exits: terminal shows `[Claude exited with code N. Press any key to close tab]` and remains readable
- WebGL renderer for performance (xterm-addon-webgl), with automatic fallback to canvas renderer if WebGL is unavailable (e.g., GPU acceleration disabled)

### New-Tab Page

Full feature parity with the current Python launcher:
- Project list with real-time case-insensitive filter (type to filter, Backspace to delete, Esc to clear)
- Navigation: Up/Down arrows, PageUp/PageDown, Home/End
- Status bar with toggles:
  - Tab key: cycle model (sonnet / opus / haiku / sonnet [1M] / opus [1M])
  - F2: cycle effort (high / medium / low)
  - F3: cycle sort (alpha / last used / most used)
  - F4: toggle permissions (--dangerously-skip-permissions)
- F5: create new project (pick parent dir, enter name, optional git init)
- F6: open selected project directory in Explorer
- F7: manage project directories (add/remove)
- F8: set custom label for selected project
- Enter: launch Claude on selected project (tab transitions to terminal)
- Esc: clear filter if active; close tab if filter is empty (closes app if last tab)

### Backend Rust Modules

```
src-tauri/src/
├── main.rs          — Tauri app setup, register commands and events
├── pty.rs           — ConPTY wrapper (CreatePseudoConsole, resize, close)
├── commands.rs      — Tauri IPC command handlers
├── projects.rs      — project scanning, creation, settings/usage I/O
└── claude.rs        — Claude exe resolution, env setup, spawn logic
```

### ConPTY Integration (pty.rs)

Uses `windows-rs` crate to call Windows ConPTY APIs:
- `CreatePseudoConsole` — create a pseudo console with initial size
- `ResizePseudoConsole` — resize when window/tab changes
- `ClosePseudoConsole` — cleanup on tab close

Each PTY session has:
- A read thread that forwards PTY output → Tauri event `pty-output-{session_id}`
- A write channel that receives input from frontend → PTY stdin
- An exit watcher that emits `pty-exit-{session_id}` with exit code

**Output batching:** The read thread buffers PTY output with a 16ms deadline (one frame) before emitting events, reducing IPC overhead during output bursts.

**Write size limit:** `write_pty` accepts a maximum of 64KB per call. Larger pastes are chunked by the frontend.

### Session Registry and Lifecycle

The backend maintains a `SessionRegistry` (a `HashMap<String, PtySession>` behind a `Mutex`) that tracks all active PTY sessions. Cleanup happens on:

1. **Normal tab close**: frontend calls `kill_session` → backend terminates process, closes PTY, removes from registry
2. **App close (voluntary)**: Tauri `on_window_event(CloseRequested)` handler iterates all sessions and terminates them
3. **App crash / force-kill**: Tauri `on_exit` hook performs the same cleanup. Additionally, Claude child processes are spawned in a Win32 Job Object — if the parent process dies, the OS automatically terminates all children.
4. **Frontend webview reload**: backend detects missing frontend via a periodic heartbeat (every 5s). Sessions with no frontend activity for 30s after a missed heartbeat are reaped.

### Tauri IPC Commands

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `spawn_claude` | `project_path, model_id, effort, skip_perms` | `session_id: String` | Create PTY, spawn Claude process |
| `write_pty` | `session_id, data: Vec<u8>` | `()` | Send input to PTY stdin (max 64KB) |
| `resize_pty` | `session_id, cols, rows` | `()` | Resize pseudo console |
| `kill_session` | `session_id` | `()` | Terminate Claude process |
| `scan_projects` | `project_dirs: Vec<String>` | `Vec<ProjectInfo>` | Scan projects (git branch, dirty, CLAUDE.md) |
| `load_settings` | — | `Settings` | Read settings JSON |
| `save_settings` | `settings: Settings` | `()` | Write settings JSON atomically |
| `load_usage` | — | `UsageData` | Read usage JSON |
| `record_usage` | `project_path: String` | `()` | Update usage after launch |
| `open_in_explorer` | `path: String` | `()` | Open folder in Windows Explorer |
| `create_project` | `parent, name, git_init` | `String` | Create directory, optional git init |
| `heartbeat` | `session_id` | `()` | Frontend keepalive for session |

### Tauri Events (Backend → Frontend)

| Event | Payload | Description |
|-------|---------|-------------|
| `pty-output-{session_id}` | `Vec<u8>` | PTY produced output (batched at 16ms) |
| `pty-exit-{session_id}` | `{ code: i32 }` | Claude process exited |

### Project Scanning

`scan_projects` runs asynchronously with a **2-second timeout per project** (matching the Python launcher). Uses `git status --branch --porcelain=v2` per project to detect branch name and dirty status. The frontend shows a loading indicator while scanning.

### Tauri Permissions (tauri.conf.json)

The Tauri capability file must grant permissions for all IPC commands listed above. The CSP must allow:
- Default Tauri IPC (invoke + events)
- No external network access needed (all local)

## Data Files

Reuses the existing JSON files from the Python launcher.

### Data directory resolution

The Tauri app resolves the data directory as **the directory containing the executable**. This matches the Python launcher's behavior (`_SCRIPT_DIR`). During development (`npm run tauri dev`), it falls back to the repo root.

Constant: `DATA_DIR` — resolved at startup via `std::env::current_exe().parent()`.

### claude-launcher-settings.json
```json
{
  "version": 1,
  "model_idx": 0,
  "effort_idx": 0,
  "sort_idx": 0,
  "skip_perms": false,
  "project_dirs": ["D:\\Projects"],
  "project_labels": { "D:\\Projects\\my-app": "My App" }
}
```

Forward-compatibility: unknown keys are preserved when reading and writing. The `version` field enables future migrations. The Python launcher ignores unknown keys, so adding `"version"` is safe.

### claude-launcher-usage.json
```json
{
  "D:\\Projects\\my-app": { "last_used": 1710000000.0, "count": 42 }
}
```

Both files are written atomically (write to `.tmp`, then rename). Settings has `.bak` fallback for corruption recovery.

## Environment Variables

### Set before spawning Claude
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`

### Read at startup
- `CLAUDE_LAUNCHER_PROJECTS_DIR` — default projects directory when no settings file exists (same as Python launcher). Overrides `D:\Projects` default.

## Claude Executable Resolution

Same logic as current Python launcher:
1. Search PATH for `claude` (`which` crate or manual PATH search)
2. Fallback: `~/.local/bin/claude.exe` (via `dirs::home_dir()`)
3. Handle `.cmd`/`.bat` shims by routing through `cmd.exe /c`

## Models

| Display | Model ID |
|---------|----------|
| sonnet | `claude-sonnet-4-6` |
| opus | `claude-opus-4-6` |
| haiku | `claude-haiku-4-5` |
| sonnet [1M] | `claude-sonnet-4-6[1m]` |
| opus [1M] | `claude-opus-4-6[1m]` |

## Error Handling

- **Claude not found**: error message displayed in the tab (not app crash)
- **PTY creation failure**: error message in tab with details
- **Claude crash/error exit**: terminal shows exit code, tab stays open for reading output
- **Corrupt settings**: fallback to `.bak`, then defaults (same as Python launcher)
- **App close with active sessions**: confirmation dialog "N active Claude sessions. Close all?"
- **Max tabs reached**: warning message, "+" button disabled

## Security

- Input sanitization: Rust equivalent of `safe_str()` strips ANSI/VT escapes from user input
- UNC paths (`\\server\share`) rejected in all directory inputs
- Path traversal check on `create_project` (name must not escape parent directory)
- Labels limited to 60 characters, sanitized
- Child processes spawned in a Win32 Job Object for guaranteed cleanup

## Project Structure

```
claude-code-launcher/
├── claude-code-launcher.py          # Python launcher (stays, works independently)
├── claude-code-launcher.bat
├── CLAUDE.md
├── app/                             # New Tauri app
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── capabilities/
│   │   │   └── default.json         # IPC permission grants
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── pty.rs
│   │   │   ├── commands.rs
│   │   │   ├── projects.rs
│   │   │   └── claude.rs
│   │   └── build.rs
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── TabBar.tsx
│   │   │   ├── Terminal.tsx
│   │   │   ├── NewTabPage.tsx
│   │   │   ├── ProjectList.tsx
│   │   │   └── StatusBar.tsx
│   │   └── hooks/
│   │       ├── usePty.ts
│   │       └── useProjects.ts
│   ├── package.json
│   └── tsconfig.json
```

## Keyboard Shortcuts

### Global (always active)
- Ctrl+T: new tab
- Ctrl+F4: close current tab (avoids conflict with Ctrl+W readline binding in terminal)
- Ctrl+Tab: next tab
- Ctrl+Shift+Tab: previous tab

### Key interception mechanism
Global shortcuts are intercepted using xterm.js `attachCustomKeyEventHandler`. This callback runs before xterm processes the key event. Only the specific global shortcuts listed above are intercepted; all other keys pass through to the PTY. This ensures Claude CLI receives Ctrl+C, Ctrl+W, and all other key combinations unmodified.

### New-tab page (same as Python launcher)
- Up/Down: move selection
- PageUp/PageDown: scroll by page
- Home/End: first/last project
- Type: filter projects
- Backspace: delete last filter char
- Esc: clear filter if active; close tab if filter is empty (closes app if last tab)
- Tab key: cycle model
- F2: cycle effort
- F3: cycle sort
- F4: toggle permissions
- F5: create project
- F6: open in Explorer
- F7: manage directories
- F8: set label
- Enter: launch Claude on selected project

### Terminal tab
- All input goes to the PTY (Claude)
- Only Ctrl+T, Ctrl+F4, Ctrl+Tab, Ctrl+Shift+Tab are intercepted (via `attachCustomKeyEventHandler`)
- All other keys including Ctrl+C, Ctrl+W, Ctrl+D pass through to Claude
