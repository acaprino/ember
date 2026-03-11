# Tauri Desktop Pipeline Report

## Target
Full project review of Claude Launcher — a Tauri 2 desktop app for selecting and launching Claude Code CLI sessions in tabbed terminals with Windows ConPTY.

## Executive Summary
The app has a solid architectural foundation: correct use of Tauri's Channel API for PTY streaming, atomic file persistence, Win32 Job Object for orphan cleanup, and a clean React component tree. The Rust backend and Tauri IPC issues (Phases 1-2) have been **fixed** in this session. The remaining findings from Phases 3-5 are frontend optimization and polish items — none are blockers, but addressing them would elevate the app from functional prototype to polished desktop tool.

## Score Summary

| Layer               | Critical | High | Medium | Low | Status |
|---------------------|----------|------|--------|-----|--------|
| Rust Backend        | ~~1~~    | ~~4~~| ~~8~~  | ~~7~~| **FIXED** |
| Tauri IPC           | 0        | ~~4~~| ~~7~~  | ~~6~~| **FIXED** |
| React Performance   | 0        | 2    | 6      | 6   | Reviewed |
| Layout              | 0        | 3    | 7      | 5   | Reviewed |
| UI Polish           | 1        | 6    | 9      | 9   | Reviewed |
| **Remaining**       | **1**    | **11**| **22** | **20**| |

## Fixed Issues (Phases 1-2)

All 37 findings from the Rust backend and Tauri IPC reviews have been implemented:

- **C1**: Path traversal check rewritten with direct name validation
- **H1-H4**: PtySession safety docs, mutex poisoning handled, reader thread documented, partial-read flush added
- **T1**: PTY output switched to base64 encoding (~10x bandwidth reduction)
- **T2**: Blocking IPC commands wrapped in `spawn_blocking`
- **T3**: `writePty` simplified to accept string directly
- **T4**: Cargo release profile added (LTO, strip, codegen-units=1)
- **T5-T6**: ResizeObserver deduplication, heartbeat exit check
- **T9-T10**: Double IPC eliminated, settings save rollback added
- **M1-M8**: Regex caching, &Path signature, bounded threads, dimension validation, window label check, data_dir fallback, lib.rs removed, usage race fix
- **L1-L7**: Env dedup, dead code removed, path validation, Drop cleanup, WaitForSingleObject check, tokio features trimmed

## Remaining: Critical & High Priority Issues

### Critical
| ID | Phase | File | Issue |
|----|-------|------|-------|
| C1 | Polish | TabBar.tsx, App.tsx | No tab entrance/exit animation — tabs snap in/out instantly |

### High
| ID | Phase | File | Issue |
|----|-------|------|-------|
| R1 | React | App.tsx:150-154 | Inline lambda props defeat `memo` on Terminal |
| R2 | React | ProjectsContext.tsx | Context broadcasts all changes to all consumers |
| H1 | Layout | App.css | No CSS-level minimum window size enforcement |
| H2 | Layout | ProjectList.tsx | Project list not virtualized for large collections |
| H3 | Layout | StatusBar.css | Status bar items overlap at narrow widths |
| H1 | Polish | NewTabPage.tsx | Loading state is plain text with no visual treatment |
| H2 | Polish | NewTabPage.tsx | Error state uses inline styles, no retry feedback |
| H3 | Polish | ProjectList.tsx | Empty state is visually flat, offers no guidance |
| H4 | Polish | ProjectList.css | Project items lack horizontal padding |
| H5 | Polish | ProjectList.css | No active/press state on project items |
| H6 | Polish | StatusBar.css | Status bar items not visually interactive despite being cyclable |

## Remaining: Medium & Low Priority Issues

### React Performance (Phase 3)
- **R3** (M): Keyboard handler re-attaches on every state change
- **R4** (M): `filteredProjects` useMemo recomputes on any settings change
- **R5** (M): `onRequestClose` lambda defeats memo on NewTabPage
- **R6** (M): Tab switching triggers unnecessary re-renders
- **R7** (M): `nextTab`/`prevTab` always create new tabs array
- **R8** (M): No Vite build optimizations or chunk splitting
- **R9-R14** (L): Callback recreation, no virtualization, lint warnings, window.confirm blocking, getCurrentWindow caching, no error boundary

### Layout (Phase 4)
- **M1-M7**: Project item padding, terminal padding, tab overflow, shortcut hints truncation, fixed px typography, long path overflow, spacing scale gaps
- **L1-L5**: Inline styles, tab bar gap, hover feedback, empty state styles, line-height density

### UI Polish (Phase 5)
- **M1-M9**: Tab close/add press states, active tab indicator, selection transition, filter container, launching feedback, header styling, shortcut hints readability, MD badge clarity
- **L1-L9**: GPU hints, tab overflow, terminal entrance animation, perms warning, missing palette colors, cursor drag, shared empty styles, border hierarchy, pulse animation duration

## What's Done Well
1. **Channel API for PTY streaming** — Direct typed channel, not global event bus
2. **Win32 Job Object** — Orphan process cleanup safety net
3. **Atomic file writes** — `.tmp` + rename with `.bak` backup
4. **Output batching** — 16ms intervals prevent IPC flooding
5. **Heartbeat reaper** — Cleans zombie sessions on frontend crash
6. **Catppuccin Mocha tokens** — Cohesive color system with proper surface layering
7. **ARIA roles** — tablist, tab, listbox, option, aria-live on status bar
8. **prefers-reduced-motion** — Global animation kill switch
9. **Tab drag region** — Correct Tauri custom titlebar pattern
10. **Ref pattern for Terminal** — Stable callbacks avoiding stale closures
11. **CSS custom properties** — Consistent spacing/typography/color tokens
12. **WebGL xterm with fallback** — GPU rendering with graceful degradation

## Recommended Action Plan

### Immediate (high impact, low effort)
1. Add tab entrance/exit CSS transitions (C1 Polish)
2. Add horizontal padding to project items (H4 Polish, M1 Layout)
3. Style loading/empty/error states properly (H1-H3 Polish)
4. Make status bar items look interactive (H6 Polish)

### Next Sprint
5. Extract Terminal callback props to avoid inline lambdas (R1 React)
6. Split ProjectsContext into separate contexts (R2 React)
7. Add CSS min-width/min-height to prevent layout collapse (H1 Layout)
8. Add press/active states to all interactive elements (H5 Polish, M1-M2 Polish)
9. Stabilize NewTabPage keyboard handler with useCallback (R3 React)

### Nice to Have
10. Virtualize project list for large collections (H2 Layout, R10 React)
11. Add Vite build config with chunk splitting (R8 React)
12. Add tab overflow indicator (M3 Layout)
13. Add transition to selected project indicator (M4 Polish)

## Pipeline Metadata
- Review date: 2026-03-11
- Phases completed: 1, 2, 3, 4, 5, 6
- Phases 1-2: All findings fixed and verified (Rust + TypeScript compile clean)
- Flags applied: none
