# Pipeline Scope

## Target
Full project review of Claude Launcher — a Tauri 2 desktop app for selecting and launching Claude Code CLI on local projects. Features tabbed terminal sessions with PTY, project scanning, and keyboard-driven navigation.

## Rust Backend Files
- app/src-tauri/src/main.rs — App entry point, Tauri builder, command registration
- app/src-tauri/src/lib.rs — Module declarations
- app/src-tauri/src/commands.rs — Tauri IPC command handlers
- app/src-tauri/src/claude.rs — Claude CLI resolution, command building, env setup
- app/src-tauri/src/projects.rs — Project scanning, settings/usage persistence
- app/src-tauri/src/pty.rs — Windows pseudo-console (ConPTY) wrapper
- app/src-tauri/src/session.rs — Session registry, lifecycle management, reaper

## Frontend Files
- app/src/main.tsx — React entry point
- app/src/App.tsx — Root component, tab management, global shortcuts
- app/src/App.css — Global styles
- app/src/types.ts — Shared types (models, efforts, sort orders)
- app/src/components/NewTabPage.tsx — Project picker with keyboard navigation
- app/src/components/NewTabPage.css
- app/src/components/ProjectList.tsx — Scrollable project list
- app/src/components/ProjectList.css
- app/src/components/StatusBar.tsx — Model/effort/sort/perms display
- app/src/components/StatusBar.css
- app/src/components/TabBar.tsx — Tab strip UI
- app/src/components/TabBar.css
- app/src/components/Terminal.tsx — xterm.js terminal with PTY integration
- app/src/components/Terminal.css
- app/src/hooks/useTabManager.ts — Tab state management
- app/src/hooks/useProjects.ts — Project loading, filtering, sorting
- app/src/hooks/usePty.ts — Tauri IPC wrappers for PTY commands
- app/src/contexts/ProjectsContext.tsx — Projects context provider

## Config Files
- app/src-tauri/tauri.conf.json — Tauri app config, CSP, window settings
- app/src-tauri/Cargo.toml — Rust dependencies
- app/src-tauri/capabilities/default.json — IPC permissions
- app/package.json — Frontend dependencies

## Flags
- Rust Only: no
- Frontend Only: no
- Strict Mode: no

## Pipeline Phases
1. Rust Backend Review
2. Tauri IPC & Optimization
3. React Frontend Performance
4. Layout Composition
5. UI Polish & Animations
