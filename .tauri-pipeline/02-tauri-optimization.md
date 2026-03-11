# Tauri IPC & Optimization Review

**Scope**: Tauri 2 IPC architecture, plugin usage, security, build optimization, event system
**Files reviewed**: `tauri.conf.json`, `capabilities/default.json`, `permissions/default.toml`, `Cargo.toml`, `main.rs`, `commands.rs`, `session.rs`, `pty.rs`, `usePty.ts`, `useProjects.ts`, `useTabManager.ts`, `Terminal.tsx`, `App.tsx`, `ProjectsContext.tsx`, `types.ts`, `vite.config.ts`, `package.json`
**Date**: 2026-03-11

---

## Executive Summary

The IPC architecture is fundamentally sound. The app correctly uses Tauri's Channel API for high-frequency PTY streaming rather than the emit/listen event system -- this is the single most important architectural decision for a terminal emulator and it is done right. The permission model is well-scoped with per-command granularity. However, there are meaningful optimization opportunities: the PTY output payload format wastes bandwidth via JSON number arrays instead of binary transfer, the Cargo build profile lacks release optimizations, the Vite config has no chunking strategy, and several IPC commands perform blocking I/O on the async runtime without `spawn_blocking`. The CSP is appropriately restrictive.

---

## Findings

### HIGH

#### T1. PTY output serialized as JSON number array instead of binary
**File**: `session.rs` line 20-21, `usePty.ts` lines 3-4, 22
**Issue**: `PtyEvent::Output { data: Vec<u8> }` is serialized via serde as a JSON array of numbers. A 4 KB terminal chunk becomes `[72,101,108,108,111,...]` -- roughly 8-15x larger than the raw bytes due to JSON encoding of each byte as a decimal number with comma separators. At high output rates (e.g., `cat` of a large file), this creates significant serialization overhead on the Rust side and parsing overhead on the JS side.

The frontend then has to construct `new Uint8Array(msg.data)` from this number array (line 22 of `usePty.ts`), adding another allocation.

**Impact**: For a terminal emulator producing continuous output, this is the hottest IPC path. A 4 KB read becomes ~20-40 KB of JSON text. With batching up to 8 KB, peaks could hit 40-80 KB of JSON per 16ms frame -- roughly 2.5-5 MB/s of JSON parsing overhead for a fast-scrolling terminal.

**Fix**: Use Tauri's `Response` type for binary payloads, or encode the bytes as base64 in a single string field instead of a number array. The most efficient approach for Channel-based streaming is to base64-encode:

```rust
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PtyEvent {
    Output { data: String },  // base64-encoded
    Exit { code: i32 },
}

// In reader thread:
let encoded = STANDARD.encode(&data);
channel.send(PtyEvent::Output { data: encoded })
```

Frontend:
```typescript
if (msg.type === "output") {
  const binary = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
  onOutput(binary);
}
```

This reduces the JSON payload from ~10x to ~1.33x of the original binary size. Alternatively, investigate whether Tauri 2's Channel supports raw byte sending (as of Tauri 2.x, `Channel<Vec<u8>>` may serialize as a byte array in some transports).

#### T2. Blocking file I/O in async command handlers without `spawn_blocking`
**File**: `commands.rs` lines 74-100
**Issue**: Several async Tauri command handlers call synchronous file I/O functions directly:
- `scan_projects` (line 78-79): spawns threads internally, but the caller blocks on `mpsc::recv` collection
- `load_settings` (line 83-84): reads from disk synchronously
- `save_settings` (line 88-89): writes to disk synchronously
- `load_usage` (line 93-94): reads from disk synchronously
- `record_usage` (line 98-99): reads, modifies, writes to disk synchronously
- `create_project` (line 112-117): creates directories and runs `git init` synchronously

Tauri's async command handlers run on the tokio runtime. Blocking the runtime thread pool with file I/O prevents other commands from being processed. With the default tokio thread count (typically = CPU cores), sustained blocking could stall IPC processing for active PTY sessions.

**Impact**: During a `scan_projects` call that spawns many threads and waits for git subprocess results, other IPC commands (including `write_pty` and `heartbeat`) could experience increased latency. In practice, `scan_projects` is called infrequently enough that this is unlikely to cause visible issues, but `record_usage` during rapid tab creation could block.

**Fix**: Wrap blocking calls with `tokio::task::spawn_blocking`:

```rust
#[tauri::command]
pub async fn load_settings() -> Result<Settings, String> {
    tokio::task::spawn_blocking(|| Ok(projects::load_settings()))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn scan_projects(
    project_dirs: Vec<String>,
    labels: std::collections::HashMap<String, String>,
) -> Result<Vec<ProjectInfo>, String> {
    tokio::task::spawn_blocking(move || Ok(projects::scan_projects(&project_dirs, &labels)))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}
```

#### T3. `write_pty` converts string to byte array via JSON round-trip
**File**: `usePty.ts` lines 41-44, `commands.rs` lines 32-39
**Issue**: The `writePty` function converts a string to `Array.from(encoder.encode(data))`, which creates a JavaScript `Array` of numbers from a `Uint8Array`. This array is then JSON-serialized as `[107, 101, 121, ...]` and sent over IPC, where Rust deserializes it back into `Vec<u8>`. This is the reverse of T1 -- input keystrokes are small (typically 1-6 bytes), so the overhead per-keystroke is negligible, but the pattern is unnecessarily wasteful.

**Impact**: Low for typical terminal input (single keystrokes). Could matter for paste operations of large text blocks.

**Fix**: Send the string directly and let Rust handle encoding:

```rust
#[tauri::command]
pub async fn write_pty(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    data: String,  // Accept string directly
) -> Result<(), String> {
    registry.write(&session_id, data.as_bytes())
}
```

```typescript
export async function writePty(sessionId: string, data: string): Promise<void> {
  await invoke("write_pty", { sessionId, data });
}
```

#### T4. No Cargo release profile optimizations
**File**: `Cargo.toml` (entire file -- no `[profile.release]` section present)
**Issue**: The `Cargo.toml` has no `[profile.release]` section. The default Rust release profile uses `codegen-units = 16`, `lto = false`, and `opt-level = 3`. Missing LTO and high codegen-units produce a larger, slower binary.

**Impact**: Binary size could be 10-30% larger than necessary. LTO enables cross-crate optimization which is particularly important when the `windows` crate (with many FFI wrappers) is heavily used.

**Fix**: Add to `Cargo.toml`:

```toml
[profile.release]
codegen-units = 1
lto = true
opt-level = 3
strip = true
panic = "abort"
```

`strip = true` removes debug symbols. `panic = "abort"` saves binary size and is appropriate since panics in this app are unrecoverable anyway. `codegen-units = 1` gives better optimization at the cost of longer compile times (acceptable for release builds).

---

### MEDIUM

#### T5. `ResizeObserver` fires `resizePty` IPC on every pixel change without throttling
**File**: `Terminal.tsx` lines 101-106
**Issue**: The `ResizeObserver` callback calls `fitAddon.fit()` and then `resizePty()` on every resize observation. During a window drag-resize, `ResizeObserver` can fire at 60+ FPS. Each call invokes `fitAddon.fit()` (which recalculates terminal dimensions) and sends an IPC `resize_pty` command. While xterm.js's `fit()` only changes cols/rows at discrete breakpoints (so the IPC call is not truly 60 FPS), there is no guard preventing redundant calls when cols/rows have not actually changed.

**Impact**: During window resizing, dozens of redundant IPC round-trips and `ResizePseudoConsole` Win32 calls occur. Each `ResizePseudoConsole` call has kernel overhead.

**Fix**: Track previous dimensions and only call `resizePty` when they change:

```typescript
let lastCols = 0, lastRows = 0;
const observer = new ResizeObserver(() => {
  fitAddon.fit();
  const cols = xterm.cols;
  const rows = xterm.rows;
  if (sessionIdRef.current && (cols !== lastCols || rows !== lastRows)) {
    lastCols = cols;
    lastRows = rows;
    resizePty(sessionIdRef.current, cols, rows);
  }
});
```

#### T6. Heartbeat interval fires for sessions that have already exited
**File**: `Terminal.tsx` lines 143-147
**Issue**: The heartbeat `setInterval` runs every 5 seconds for the entire lifetime of the component, even after the PTY process has exited (`exitedRef.current === true`). These heartbeat calls hit the Rust backend, acquire the mutex, look up the session (which may have been removed by the exit watcher), and return an error that is silently discarded.

**Impact**: Unnecessary IPC round-trips and mutex acquisition after session exit. With 10 tabs where 8 have exited, that is 8 wasted IPC calls every 5 seconds.

**Fix**: Check `exitedRef` before sending:

```typescript
const heartbeatInterval = setInterval(() => {
  if (sessionIdRef.current && !exitedRef.current) {
    sendHeartbeat(sessionIdRef.current);
  }
}, 5000);
```

#### T7. `scan_projects` called from async context but spawns raw OS threads internally
**File**: `projects.rs` lines 200-218, `commands.rs` lines 74-80
**Issue**: Cross-referencing with Phase 1 finding M3. From the Tauri IPC perspective, `scan_projects` is an async command that internally spawns one `std::thread` per project directory and collects via `mpsc::channel`. This means the async runtime thread is blocked waiting on `rx.iter().collect()` while N OS threads run git subprocesses. Since this is already an async command, the entire function blocks the tokio worker thread until all git subprocesses complete.

**Impact**: If a user has 50 project directories and git is slow on a network drive, the tokio worker thread is blocked for the entire scan duration (could be seconds), reducing available parallelism for other IPC commands.

**Fix**: This should be wrapped in `spawn_blocking` (as noted in T2), or rewritten to use `tokio::process::Command` for async subprocess execution.

#### T8. Vite config lacks build optimizations and chunking strategy
**File**: `vite.config.ts` (entire file)
**Issue**: The Vite config has no `build` section. This means:
- No `target` specification (defaults to `modules` instead of `esnext`)
- No manual chunk splitting (React, xterm.js, and app code are bundled together)
- No minification configuration
- No tree-shaking hints

For a Tauri app where the WebView is always a modern engine (WebView2/Chromium on Windows), `esnext` target avoids unnecessary polyfills and transpilation.

**Impact**: Bundle size is larger than necessary. Lack of chunk splitting means the entire bundle reloads on any code change during development (HMR mitigates this). For production, a single large chunk may have slightly worse initial parse time.

**Fix**:

```typescript
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  build: {
    target: 'esnext',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl'],
        },
      },
    },
  },
  // ... server config
}));
```

#### T9. `useProjects` hook reloads full usage file after every `recordUsage` call
**File**: `useProjects.ts` lines 109-113
**Issue**: `recordUsage` calls `invoke("record_usage", ...)` and then immediately calls `invoke("load_usage")` to refresh the entire usage data map. This is two sequential IPC round-trips when one would suffice. The `record_usage` command on the Rust side already has the updated data.

**Impact**: Two IPC round-trips instead of one. The second call reads from disk unnecessarily.

**Fix**: Have `record_usage` return the updated `UsageData`:

```rust
#[tauri::command]
pub async fn record_usage(project_path: String) -> Result<UsageData, String> {
    projects::record_usage(&project_path)
        .map_err(|e| format!("Failed to record usage: {e}"))?;
    Ok(projects::load_usage())
}
```

```typescript
const recordUsage = useCallback(async (projectPath: string) => {
  const u = await invoke<UsageData>("record_usage", { projectPath });
  setUsage(u);
}, []);
```

Or better yet, have `record_usage` return just the updated entry and merge it locally.

#### T10. `updateSettings` does not await save completion before further UI interaction
**File**: `useProjects.ts` lines 45-53
**Issue**: `updateSettings` calls `setSettings(newSettings)` (optimistic update) and then `await invoke("save_settings", ...)`. If the save fails, the in-memory state diverges from disk. There is no error handling -- the promise rejection would be unhandled.

**Impact**: Settings could appear saved in the UI but not be persisted. Subsequent loads would revert to the old values.

**Fix**: Add error handling and rollback:

```typescript
const updateSettings = useCallback(
  async (updates: Partial<Settings>) => {
    if (!settings) return;
    const oldSettings = settings;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    try {
      await invoke("save_settings", { settings: newSettings });
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSettings(oldSettings); // Rollback
    }
  },
  [settings],
);
```

#### T11. `on_window_event` closure captures `Arc` clone that outlives app intent
**File**: `main.rs` lines 19, 38-42
**Issue**: Cross-referencing Phase 1 finding M5. The `on_window_event` handler fires for ANY window close event. In the current single-window design this is correct, but it is fragile. If a second window were ever added (e.g., a settings dialog), closing it would call `kill_all()` and terminate all PTY sessions. The handler does not check the window label.

More importantly from an IPC perspective, after `kill_all()` runs, the reader threads and exit watcher threads still hold `Arc<PtySession>` references. The sessions are removed from the `HashMap`, so subsequent `heartbeat` and `write_pty` calls will return "Session not found" errors. This is acceptable but could cause brief error spam from the frontend before it processes the exit events.

**Fix**: Use `on_run_event` with `RunEvent::ExitRequested` for app-wide cleanup, or check the window label:

```rust
.on_window_event(move |window, event| {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        if window.label() == "main" {
            registry_for_cleanup.kill_all();
        }
    }
})
```

---

### LOW

#### T12. Capability file is Windows-only but could silently break cross-platform builds
**File**: `capabilities/default.json` line 5
**Issue**: `"platforms": ["windows"]` restricts these capabilities to Windows only. This is correct for a Windows-only app, but if someone attempts to build for another platform (even for testing), all IPC commands will be denied with no obvious error message -- Tauri will simply reject every `invoke()` call.

**Impact**: Developer confusion if cross-platform is ever attempted.

**Fix**: This is fine as-is given the Windows-only constraint in CLAUDE.md. Document the restriction in a comment or add a fallback capability file for other platforms if needed.

#### T13. CSP does not include `font-src` directive
**File**: `tauri.conf.json` line 24
**Issue**: The CSP is `"default-src 'self'; style-src 'self' 'unsafe-inline'"`. The `font-src` directive is not set, so it falls back to `default-src 'self'`. xterm.js typically does not load fonts via CSS `@font-face` (it uses the system font stack configured in the JS options), but if a user installs a custom font package or the WebGL addon attempts to load a font, it would be blocked without a clear error.

**Impact**: Minimal. The configured fonts (`Cascadia Code`, `Consolas`) are system fonts resolved by the OS, not loaded via `font-src`.

**Fix**: No action needed. The current CSP is appropriately restrictive. If web fonts are ever needed, add `font-src 'self'`.

#### T14. `unsafe-inline` in CSP `style-src` weakens content security
**File**: `tauri.conf.json` line 24
**Issue**: `style-src 'self' 'unsafe-inline'` allows inline styles. This is commonly needed for React applications and xterm.js (which injects inline styles for terminal rendering). However, it does weaken the CSP against style-based injection attacks.

**Impact**: Low for a local desktop app with no remote content loading. xterm.js requires inline styles to function, so removing `unsafe-inline` would break the terminal.

**Fix**: No action needed. This is a necessary trade-off for xterm.js compatibility in a Tauri app.

#### T15. `tokio` full features bloat (reinforcing Phase 1 L7)
**File**: `Cargo.toml` line 17
**Issue**: `tokio = { version = "1", features = ["full"] }` pulls all features including `net`, `io`, `fs`, `signal`, `process`, etc. The codebase only uses `std::thread` for concurrency and Tauri's built-in async runtime. The `tokio` dependency is required by Tauri but `features = ["full"]` is not.

If the fix for T2 (`spawn_blocking`) is adopted, only `rt` and `rt-multi-thread` are needed.

**Impact**: Adds ~200-400 KB to binary size and slows compilation.

**Fix**:
```toml
tokio = { version = "1", features = ["rt", "rt-multi-thread"] }
```

Or if Tauri already re-exports its required tokio features, the explicit dependency may not be needed at all.

#### T16. `Channel` reference kept in `channelRef` but never used after setup
**File**: `Terminal.tsx` lines 40, 133-135, 155-157
**Issue**: The `channelRef` stores the Channel object returned from `spawnClaude` but the only use is in cleanup to null the `onmessage` callback. The Channel object is also referenced by the Tauri IPC system internally. Storing it in a ref is redundant for keeping it alive -- the `invoke` call already holds the reference.

**Impact**: Negligible. The ref ensures the channel is not garbage-collected, which is a reasonable defensive practice.

**Fix**: No action needed, but the cleanup could be simplified to just `channelRef.current = null` instead of setting `onmessage` to an empty function.

#### T17. `onRequestClose` lambda in App.tsx creates new closure on every render
**File**: `App.tsx` lines 136, 150
**Issue**: `onRequestClose={() => closeTab(tab.id)}` creates a new arrow function on every render of the parent `App` component. Since `Terminal` is wrapped in `memo`, this new reference would normally trigger a re-render. However, `Terminal` stores `onRequestClose` in a ref (line 42, 48-50 of Terminal.tsx) rather than using it in dependency arrays, so the `memo` still prevents re-renders based on other prop changes. But the prop comparison in `memo` still fails for `onRequestClose`, meaning `memo` is partially defeated -- the component function re-executes even though no visible change occurs.

Similarly, `onSessionCreated`, `onNewOutput`, `onExit`, and `onError` lambdas on lines 146-149 capture `tab.id`, creating new closures each render.

**Impact**: Terminal components re-execute their render function on every parent render, though the useEffect with `[]` deps means no real work is repeated. The xterm.js instance is not recreated. Practical impact is negligible for <= 10 tabs.

**Fix**: Use `useCallback` with `tab.id` bound, or pass `tabId` as a prop and let Terminal call the callbacks with its own ID.

---

## What's Done Well

1. **Channel API for PTY streaming** -- The most critical architectural decision. Using `Channel<PtyEvent>` instead of `emit`/`listen` for terminal output avoids the global event bus overhead and provides a direct typed channel from the Rust reader thread to the specific frontend component. This is exactly the right pattern for high-frequency unidirectional data flow.

2. **Output batching at 16ms intervals** -- The reader thread in `session.rs` (lines 78-96) batches output at roughly 60 FPS intervals, preventing IPC flooding when the terminal produces rapid output. The 8 KB size threshold provides a secondary flush trigger for burst output.

3. **Fine-grained capability permissions** -- Every IPC command has its own permission entry in `permissions/default.toml`, and the capability file in `capabilities/default.json` explicitly lists each allowed command. This follows the principle of least privilege. No wildcard permissions are used.

4. **Tight CSP** -- `default-src 'self'; style-src 'self' 'unsafe-inline'` blocks all external resource loading. No `script-src 'unsafe-eval'`, no `connect-src` to external URLs. For a local desktop app, this is appropriately locked down.

5. **State management via Tauri `manage()`** -- The `SessionRegistry` is properly shared via `tauri::State`, avoiding global mutable state. This is the idiomatic Tauri pattern for shared backend state.

6. **WebGL addon with fallback** -- `Terminal.tsx` (lines 71-77) attempts WebGL rendering with a graceful fallback to canvas. The `onContextLoss` handler properly disposes the addon, preventing rendering corruption.

7. **Platform-scoped capabilities** -- `"platforms": ["windows"]` in the capability file ensures these permissions only apply on the target platform, which is correct for a Windows-only ConPTY-based app.

8. **Heartbeat-based session reaping** -- The 5-second heartbeat from `Terminal.tsx` combined with the 30-second reaper timeout in `session.rs` provides a safety net for orphaned sessions when the frontend crashes or becomes unresponsive.

9. **Stable callback refs in Terminal** -- `isActiveRef` and `onRequestCloseRef` patterns (Terminal.tsx lines 41-50) avoid stale closures in the long-lived `useEffect` without adding to its dependency array. This correctly prevents the xterm.js instance from being torn down and recreated on prop changes.

10. **`serde(rename_all = "camelCase")` on IPC types** -- Ensures Rust snake_case fields map to JS camelCase conventions automatically, preventing field name mismatch bugs.

---

## Summary Table

| ID  | Severity | File(s) | Issue |
|-----|----------|---------|-------|
| T1  | High | `session.rs:20`, `usePty.ts:3-4` | PTY output as JSON number array (~10x bloat) |
| T2  | High | `commands.rs:74-117` | Blocking I/O on async runtime (no `spawn_blocking`) |
| T3  | High | `usePty.ts:41-44`, `commands.rs:32-39` | Write input via JSON number array round-trip |
| T4  | High | `Cargo.toml` | No release profile (missing LTO, strip, codegen-units) |
| T5  | Medium | `Terminal.tsx:101-106` | ResizeObserver sends redundant resize IPC calls |
| T6  | Medium | `Terminal.tsx:143-147` | Heartbeat fires after session exit |
| T7  | Medium | `projects.rs:200-218` | `scan_projects` blocks tokio thread with OS thread joins |
| T8  | Medium | `vite.config.ts` | No build target, chunking, or minification config |
| T9  | Medium | `useProjects.ts:109-113` | Double IPC round-trip for record + reload usage |
| T10 | Medium | `useProjects.ts:45-53` | No error handling/rollback on settings save failure |
| T11 | Medium | `main.rs:38-42` | Window close handler does not check window label |
| T12 | Low | `capabilities/default.json:5` | Windows-only platform scope (intentional, just document) |
| T13 | Low | `tauri.conf.json:24` | No explicit `font-src` (falls back to `self`, which is fine) |
| T14 | Low | `tauri.conf.json:24` | `unsafe-inline` in style-src (required by xterm.js) |
| T15 | Low | `Cargo.toml:17` | `tokio` full features unnecessary |
| T16 | Low | `Terminal.tsx:40,133-135` | Channel ref redundant (defensive, acceptable) |
| T17 | Low | `App.tsx:136,146-150` | Inline lambdas partially defeat `memo` on Terminal |

**Total**: 4 High, 7 Medium, 6 Low

---

## Priority Recommendations

**Immediate (before next release):**
1. T1 -- Switch PTY output to base64 encoding. This is the highest-impact change for terminal rendering performance.
2. T4 -- Add Cargo release profile. Zero-effort binary size and performance improvement.

**Before production:**
3. T2/T7 -- Wrap blocking commands in `spawn_blocking` to protect the async runtime.
4. T3 -- Simplify `write_pty` to accept a string directly.
5. T5 -- Deduplicate resize IPC calls.

**Nice to have:**
6. T8 -- Vite build optimizations for smaller frontend bundle.
7. T6, T9, T10 -- Minor efficiency and correctness improvements.
