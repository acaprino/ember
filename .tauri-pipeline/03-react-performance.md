# Phase 3: React Performance Review

**Scope**: React component architecture, re-render optimization, state management, IPC integration, bundle optimization, hook patterns, desktop-specific considerations
**Files reviewed**: `main.tsx`, `App.tsx`, `App.css`, `types.ts`, `Terminal.tsx`, `Terminal.css`, `TabBar.tsx`, `TabBar.css`, `NewTabPage.tsx`, `NewTabPage.css`, `ProjectList.tsx`, `ProjectList.css`, `StatusBar.tsx`, `StatusBar.css`, `usePty.ts`, `useProjects.ts`, `useTabManager.ts`, `ProjectsContext.tsx`, `vite.config.ts`, `package.json`
**Date**: 2026-03-11

---

## Executive Summary

The React frontend is well-structured for a small Tauri desktop application. The component tree is shallow (3-4 levels), state management uses React's built-in primitives rather than an external store, and the most performance-critical component (Terminal) is correctly wrapped in `memo` with stable refs for long-lived callbacks. The architecture avoids the most common React anti-patterns for this scale of application.

The primary performance concerns are: (1) inline lambda props on Terminal that partially defeat `memo`, (2) the ProjectsContext broadcasting all state changes to all consumers, (3) the keyboard event handler in NewTabPage being torn down and re-attached on every state change, and (4) missing Vite build optimizations. None of these are severe for the current scale (<= 10 tabs, <= 100 projects), but several would compound if the app grows.

---

## Findings

### HIGH

#### R1. Inline lambda props defeat `memo` on Terminal -- render function re-executes every parent render
**File**: `App.tsx` lines 150-154
**Issue**: Four callback props on `<Terminal>` are inline arrow functions that capture `tab.id`:
```tsx
onSessionCreated={(sessionId) => handleSessionCreated(tab.id, sessionId)}
onNewOutput={() => handleNewOutput(tab.id)}
onExit={(code) => handleExit(tab.id, code)}
onError={(msg) => console.error(`Tab ${tab.id} error:`, msg)}
onRequestClose={() => closeTab(tab.id)}
```

Each of these creates a new function reference on every render of `App`. Since `Terminal` is wrapped in `memo`, React performs a shallow prop comparison -- but these new references cause `Object.is` to return `false`, so `memo` is defeated and Terminal's render function re-executes on every parent render.

The practical impact is currently mitigated because Terminal stores callbacks in refs and uses an empty `[]` dependency array on its main `useEffect`, so no real teardown/setup occurs. However, the component function body still executes, including all `useRef` reads and the JSX return path. With 10 terminal tabs, every state change in `App` (tab switching, output notifications, exit codes) triggers 10 Terminal render function executions that produce identical output.

**Impact**: With 10 tabs, each `updateTab` call triggers ~10 unnecessary render function executions. At the current complexity this costs <1ms total, but it scales linearly with tab count and would matter if Terminal's render body grew.

**Fix**: Pass `tabId` as a prop (already present but unused) and let Terminal call a single stable callback:
```tsx
// In App.tsx - single stable callbacks (already partially done with handleNewOutput etc.)
// The remaining issue is the (tab.id, ...) partial application.
// Option A: Move tab.id binding into Terminal via refs
// Option B: Create a per-tab callback wrapper component

// Simplest fix - accept tabId in the callback signatures:
onSessionCreated={handleSessionCreated}  // Terminal calls with (tabId, sessionId)
onNewOutput={handleNewOutput}            // Terminal calls with (tabId)
onExit={handleExit}                      // Terminal calls with (tabId, code)
onError={handleError}                    // Terminal calls with (tabId, msg)
onRequestClose={closeTab}               // Terminal calls with (tabId)
```

Then in Terminal, use `tabId` prop (already received) in the callbacks. This makes all props stable references.

**Verification**: Enable React DevTools Profiler "Record why each component rendered". After fix, Terminal should show "Did not render" when switching between other tabs.

#### R2. ProjectsContext broadcasts all state changes to all consumers
**File**: `ProjectsContext.tsx` lines 8-15, `useProjects.ts` return value
**Issue**: `ProjectsContext.Provider` receives the entire return value of `useProjects()` as its `value` prop. This is a single object containing `settings`, `projects`, `loading`, `error`, `filter`, `setFilter`, `updateSettings`, `refresh`, `recordUsage`, and `retry`. Because `useProjects` creates a new object on every render (the return statement on line 120-131 is always a new object literal), every state change in `useProjects` triggers a re-render of ALL context consumers.

Currently the only consumer is `NewTabPage`, so this is not a problem. But the context pattern is structured to support multiple consumers (e.g., if StatusBar or ProjectList later consumed the context directly), and when that happens, every filter keystroke would re-render all consumers -- including ones that only care about `settings`.

**Impact**: Low at current scale (single consumer). Would become HIGH if multiple components consume this context.

**Fix**: Either split into separate contexts (`SettingsContext`, `ProjectsDataContext`) or memoize the context value:
```tsx
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const projects = useProjects();
  const value = useMemo(() => projects, Object.values(projects));
  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}
```

Note: The above `useMemo` with `Object.values` as deps is a rough pattern. A cleaner approach is to split the context or use `useSyncExternalStore` if the consumer count grows.

---

### MEDIUM

#### R3. NewTabPage keyboard handler re-attaches on every state change
**File**: `NewTabPage.tsx` lines 64-177
**Issue**: The keyboard event handler `useEffect` has an extensive dependency array:
```tsx
[isActive, settings, projects, selectedIdx, filter, launching, setFilter, updateSettings, launchProject, onRequestClose]
```

Every keystroke that changes `filter` or `selectedIdx` causes the effect to: (1) remove the old `keydown` listener, (2) create a new closure, (3) add the new listener. This is `removeEventListener` + `addEventListener` on every single keypress.

While the overhead of listener swap is small (~0.01ms), this pattern is fragile and unnecessary. The handler reads `projects` and `selectedIdx` on every keystroke, but these could be accessed via refs instead, keeping the effect stable.

**Impact**: Negligible per-keystroke cost, but the pattern is a maintenance risk. If the handler body grows or if additional effects depend on these values, the cascading re-renders compound.

**Fix**: Store `projects`, `selectedIdx`, `filter`, `launching`, and `settings` in refs and use a stable `useEffect` with `[isActive]` as the only dependency:
```tsx
const projectsRef = useRef(projects);
const selectedIdxRef = useRef(selectedIdx);
// ... etc

useEffect(() => { projectsRef.current = projects; }, [projects]);
// ... etc

useEffect(() => {
  if (!isActive) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    const currentProjects = projectsRef.current;
    const currentIdx = selectedIdxRef.current;
    // ... use refs instead of closure captures
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isActive]);
```

#### R4. `filteredProjects` useMemo recomputes on any settings change, not just sort_idx
**File**: `useProjects.ts` lines 61-102
**Issue**: The `filteredProjects` memo depends on the entire `settings` object. Changing `model_idx`, `effort_idx`, or `skip_perms` (via Tab, F2, F4 keys) triggers a full re-sort of the project list even though only `sort_idx` affects the sort order. With 100 projects, the sort itself is trivial (<1ms), but it produces a new array reference which triggers ProjectList to re-render and diff all project items.

**Impact**: Low. The sort is O(n log n) on a small list. But it is unnecessary work on model/effort/perms changes.

**Fix**: Extract only the needed setting:
```tsx
const sortIdx = settings?.sort_idx ?? 0;

const filteredProjects = useMemo(() => {
  if (sortIdx == null) return [];
  // ... use sortIdx instead of settings.sort_idx
}, [projects, filter, sortIdx, usage]);
```

#### R5. `onRequestClose` lambda on NewTabPage also defeats memo (if memo were added)
**File**: `App.tsx` line 139
**Issue**: `onRequestClose={() => closeTab(tab.id)}` creates a new closure per render. Unlike Terminal, `NewTabPage` is NOT wrapped in `memo`, so this is not currently causing a memo bypass. However, it means NewTabPage re-renders on every parent render regardless. If `memo` were added to NewTabPage in the future, this inline lambda would defeat it.

**Impact**: Currently neutral since NewTabPage has no memo. If added, same issue as R1.

**Fix**: Same pattern as R1 -- pass `tabId` and `closeTab` separately, let NewTabPage call `closeTab(tabId)`.

#### R6. Tab switching triggers unnecessary re-renders via `activateTab`
**File**: `useTabManager.ts` lines 61-71
**Issue**: `activateTab` calls both `setActiveTabId` and `setTabs` (to clear `hasNewOutput`). This produces two state updates. React 18+ batches these in event handlers, but the `setTabs` call maps over ALL tabs to clear `hasNewOutput` on the target tab. This creates a new `tabs` array reference even if `hasNewOutput` was already `false` on the target tab.

Since `App` re-renders when `tabs` changes, and `TabBar` receives `tabs` as a prop, every tab switch triggers a TabBar re-render even when no tab's visual state has changed (e.g., switching between two tabs neither of which has new output).

**Impact**: Low. TabBar is memoized and cheap to render. But the unnecessary `setTabs` call could be guarded:
```tsx
const activateTab = useCallback((tabId: string) => {
  setActiveTabId(tabId);
  setTabs((prev) => {
    const target = prev.find((t) => t.id === tabId);
    if (!target?.hasNewOutput) return prev; // No change needed
    return prev.map((t) =>
      t.id === tabId ? { ...t, hasNewOutput: false } : t
    );
  });
}, []);
```

#### R7. `nextTab` and `prevTab` always create new tabs array
**File**: `useTabManager.ts` lines 73-93
**Issue**: Same pattern as R6. `nextTab` and `prevTab` always call `setTabs` with a mapped array to clear `hasNewOutput`, even if the target tab has no new output. The `setActiveTabId` call inside `setTabs` is also concerning -- calling a state setter inside another state setter's updater function works but is unusual and could cause React to schedule an extra render in edge cases.

**Impact**: Low. Tab cycling is infrequent (manual user action).

**Fix**: Guard the `setTabs` call as in R6, and move `setActiveTabId` outside the `setTabs` updater.

#### R8. No Vite build optimizations or chunk splitting
**File**: `vite.config.ts`
**Issue**: The Vite config has no `build` section. This means:
- No `target: 'esnext'` -- Vite transpiles to `modules` target, adding unnecessary compatibility code for a Tauri WebView2 (always Chromium-based) environment.
- No manual chunk splitting -- React (~40KB gzipped), xterm.js (~100KB), and app code are bundled together. Any app code change invalidates the entire bundle cache during development.
- No minification configuration -- defaults to esbuild minification, which is fast but less optimal than terser for production.

**Impact**: Bundle is larger than necessary. For a Tauri desktop app where the bundle is loaded from disk (not network), the size impact is minimal (<50ms difference on SSD). But chunk splitting improves HMR rebuild times during development.

**Fix**: Add build configuration:
```typescript
build: {
  target: 'esnext',
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom'],
        'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl'],
      },
    },
  },
},
```

---

### LOW

#### R9. `updateSettings` callback recreated on every settings change
**File**: `useProjects.ts` lines 45-59
**Issue**: `updateSettings` depends on `[settings]`, so it is recreated every time settings changes. Since `NewTabPage` consumes this callback via context, every settings change (Tab to cycle model, F2 for effort, F3 for sort, F4 for perms) causes `updateSettings` to be a new reference, which triggers the keyboard handler effect to re-attach (compounding R3).

**Impact**: Low. The callback recreation itself is cheap. The cascading effect reattachment is the real cost (addressed in R3).

**Fix**: Use a ref for settings inside the callback:
```tsx
const settingsRef = useRef(settings);
useEffect(() => { settingsRef.current = settings; }, [settings]);

const updateSettings = useCallback(async (updates: Partial<Settings>) => {
  const current = settingsRef.current;
  if (!current) return;
  const newSettings = { ...current, ...updates };
  setSettings(newSettings);
  try {
    await invoke("save_settings", { settings: newSettings });
  } catch (err) {
    console.error("Failed to save settings:", err);
    setSettings(current);
  }
}, []);
```

#### R10. ProjectList does not virtualize the project list
**File**: `ProjectList.tsx`
**Issue**: All projects are rendered as DOM elements. With 100+ projects, this means 100+ DOM nodes each containing 3-5 child elements. The `scrollIntoView` call on selection change triggers layout recalculation on the entire list.

**Impact**: Negligible at current scale (most users have 10-50 projects). Would matter at 500+ projects. The TUI version handles thousands of entries, but users are unlikely to configure that many in the GUI.

**Fix**: No action needed at current scale. If project count grows significantly, add `@tanstack/react-virtual`:
```tsx
const virtualizer = useVirtualizer({
  count: projects.length,
  getScrollElement: () => listRef.current,
  estimateSize: () => 52,
  getItemKey: (index) => projects[index].path,
});
```

#### R11. `useEffect` with empty deps in Terminal has exhaustive-deps lint warning potential
**File**: `Terminal.tsx` line 166
**Issue**: The main `useEffect` on line 52 has `[]` as dependencies, but its closure captures `projectPath`, `modelIdx`, `effortIdx`, `skipPerms`, `onSessionCreated`, `onNewOutput`, `onExit`, and `onError`. ESLint's `react-hooks/exhaustive-deps` rule would flag this.

The empty deps array is intentional and correct here -- Terminal should mount once and never reinitialize. The captured values are effectively "initial props" for the terminal session. But the lint suppression should be explicit.

**Impact**: None (behavior is correct). Risk of a future developer adding a dependency and causing teardown/reinit of the xterm instance.

**Fix**: Add an eslint-disable comment:
```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

#### R12. `window.confirm()` in close handler may block the UI thread
**File**: `App.tsx` line 74
**Issue**: `window.confirm()` is a synchronous blocking call. In WebView2, this blocks the JavaScript thread until the user responds. While the dialog is open, no React renders, no heartbeats, no IPC processing occurs. The comment on line 73 acknowledges this: "window.confirm() is unreliable in WebView2."

**Impact**: Low for a close confirmation (user interaction is expected to pause). If the dialog fails to appear (as the comment suggests is possible), the close event proceeds without confirmation.

**Fix**: Replace with a Tauri dialog or a React-rendered modal for reliability:
```typescript
import { ask } from '@tauri-apps/plugin-dialog';
const confirmed = await ask(`${terminalCount} active session(s). Close all?`, {
  title: 'Confirm Close',
  kind: 'warning',
});
```

#### R13. `getCurrentWindow()` called multiple times without caching
**File**: `App.tsx` lines 31, 66
**Issue**: `getCurrentWindow()` is called in two separate effects. Each call resolves the current window handle. While this is a synchronous lookup (not IPC), caching it would be cleaner.

**Impact**: Negligible.

**Fix**: Extract to a module-level constant or a ref:
```tsx
const appWindow = useRef(getCurrentWindow());
```

#### R14. No error boundary around Terminal components
**File**: `App.tsx` lines 143-155
**Issue**: If a Terminal component throws during render (e.g., xterm.js initialization failure on a system without GPU support), the entire app crashes. There is no React error boundary to catch and recover from component-level errors.

**Impact**: Low probability but high impact when it occurs. The WebGL fallback in Terminal.tsx line 71-77 mitigates the most likely failure, but other xterm.js errors could still propagate.

**Fix**: Add an error boundary around each terminal tab:
```tsx
<ErrorBoundary fallback={<div>Terminal failed to initialize</div>}>
  <Terminal ... />
</ErrorBoundary>
```

---

## What's Done Well

1. **Shallow component tree** -- The app has only 3-4 levels of nesting (App -> TabBar/NewTabPage/Terminal -> ProjectList/StatusBar). This minimizes the "prop drilling vs context" tradeoff and keeps re-render cascades short. There are no deeply nested provider chains.

2. **`memo` on the right components** -- `Terminal`, `TabBar`, `ProjectList`, and `StatusBar` are all wrapped in `memo`. These are exactly the components that benefit: Terminal is expensive (xterm.js instance), TabBar renders on every tab change, and ProjectList/StatusBar are leaf components that receive stable-ish props.

3. **Ref pattern for stable callbacks in Terminal** -- `isActiveRef` and `onRequestCloseRef` (Terminal.tsx lines 41-50) correctly solve the stale closure problem without adding to the useEffect dependency array. This prevents the xterm.js instance from being torn down and recreated on prop changes. This is the right pattern for long-lived imperative integrations.

4. **`useMemo` for filtered/sorted projects** -- The `filteredProjects` computation in `useProjects.ts` is correctly memoized, preventing re-sort on every render. The dependency array `[projects, filter, settings, usage]` is correct (though could be narrowed per R4).

5. **Parallel initial data loading** -- `useProjects.ts` line 15 uses `Promise.all` to load settings and usage data concurrently, then chains `scan_projects` which depends on the settings result. This is the optimal sequencing.

6. **Stable `useCallback` throughout** -- `addTab`, `closeTab`, `updateTab`, `activateTab`, `nextTab`, `prevTab` in useTabManager are all wrapped in `useCallback` with minimal dependency arrays. Most have `[]` deps, meaning they are truly stable across the component lifetime.

7. **Tab panel visibility via CSS `display` rather than conditional rendering** -- `App.tsx` line 133 uses `display: none/flex` to hide inactive tabs. This preserves the xterm.js DOM and WebGL context across tab switches, avoiding expensive teardown/reinit. This is critical for terminal emulator performance.

8. **`tabsRef` for close confirmation** -- `App.tsx` lines 24-27 use a ref to access current tabs in the close handler, allowing the `onCloseRequested` effect to have `[]` deps. This prevents re-subscribing to the window event on every tab change.

9. **Clean effect cleanup in Terminal** -- The cleanup function (Terminal.tsx lines 155-164) properly clears the heartbeat interval, disconnects the ResizeObserver, kills the PTY session, nulls the channel callback, and disposes xterm. This prevents memory leaks and orphaned processes.

10. **No external state management library** -- For an app with ~6 pieces of global state (settings, usage, projects, loading, error, filter) and ~10 components, React's built-in `useState` + `useContext` is the right choice. Adding Zustand or Jotai would be over-engineering at this scale and would add bundle size for no benefit.

11. **Minimal dependency footprint** -- `package.json` shows only 5 runtime dependencies: `@tauri-apps/api`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `react`, `react-dom`. No routing library (not needed for tab-based UI), no CSS-in-JS, no state management library. This keeps the bundle small and reduces supply chain risk.

12. **Proper key usage in lists** -- `ProjectList.tsx` line 50 uses `project.path` as the key (stable, unique identifier). `App.tsx` line 131 uses `tab.id` (UUID). Neither uses array index as key.

---

## Summary Table

| ID  | Severity | File(s) | Issue |
|-----|----------|---------|-------|
| R1  | High | `App.tsx:150-154` | Inline lambdas defeat `memo` on Terminal (10 unnecessary renders per state change) |
| R2  | High | `ProjectsContext.tsx`, `useProjects.ts` | Context broadcasts all state changes to all consumers |
| R3  | Medium | `NewTabPage.tsx:64-177` | Keyboard handler re-attaches on every keystroke/state change |
| R4  | Medium | `useProjects.ts:61-102` | `filteredProjects` recomputes on model/effort/perms changes |
| R5  | Medium | `App.tsx:139` | NewTabPage `onRequestClose` inline lambda (same pattern as R1) |
| R6  | Medium | `useTabManager.ts:61-71` | Tab switch always creates new tabs array even when no output flag changes |
| R7  | Medium | `useTabManager.ts:73-93` | `nextTab`/`prevTab` always create new tabs array |
| R8  | Medium | `vite.config.ts` | No build target, chunk splitting, or minification config |
| R9  | Low | `useProjects.ts:45-59` | `updateSettings` recreated on every settings change |
| R10 | Low | `ProjectList.tsx` | No virtualization (fine at current scale) |
| R11 | Low | `Terminal.tsx:166` | Empty deps array without eslint-disable comment |
| R12 | Low | `App.tsx:74` | `window.confirm()` blocks JS thread, unreliable in WebView2 |
| R13 | Low | `App.tsx:31,66` | `getCurrentWindow()` called multiple times |
| R14 | Low | `App.tsx:143-155` | No error boundary around Terminal components |

**Total**: 2 High, 6 Medium, 4 Low

---

## Priority Recommendations

**Immediate (before next release):**
1. R1 -- Fix inline lambda props on Terminal. Highest impact for multi-tab scenarios. Pass `tabId` and let Terminal invoke callbacks with its own ID.
2. R8 -- Add Vite build config with `target: 'esnext'` and chunk splitting. Zero-risk improvement.

**Before production:**
3. R3 -- Stabilize the keyboard handler in NewTabPage using refs. Reduces unnecessary work on every keystroke.
4. R6/R7 -- Guard `setTabs` to avoid unnecessary array recreation on tab switch.

**Nice to have:**
5. R2 -- Split context or memoize value (only matters when more consumers are added).
6. R4 -- Narrow `filteredProjects` dependency to `sortIdx` instead of full `settings`.
7. R14 -- Add error boundary around Terminal for resilience.
