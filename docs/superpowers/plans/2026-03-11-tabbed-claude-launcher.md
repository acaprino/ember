# Tabbed Claude Launcher — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri 2 desktop app with tabbed terminal interface for running multiple Claude Code CLI instances simultaneously.

**Architecture:** Tauri 2 app with React frontend (xterm.js terminals) and Rust backend (ConPTY process management). Tab-only layout where "+" opens a project picker (new-tab page) and selecting a project transforms the tab into a live terminal running Claude.

**Tech Stack:** Tauri 2, React 19, TypeScript, xterm.js 5.5, windows-rs (ConPTY), win32job, serde

---

## Chunk 1: Project Scaffolding & Rust Backend Core

### Task 1: Scaffold Tauri 2 + React + TypeScript project

**Files:**
- Create: `app/` directory (entire Tauri scaffold)
- Create: `app/src-tauri/Cargo.toml`
- Create: `app/src-tauri/tauri.conf.json`
- Create: `app/src-tauri/capabilities/default.json`
- Create: `app/package.json`

- [ ] **Step 1: Scaffold the Tauri app**

Run from repo root:
```bash
cd D:/Projects/claude-code-launcher
npm create tauri-app@latest app -- --template react-ts --manager npm
```

Select: TypeScript, React, npm.

- [ ] **Step 2: Add Rust dependencies to Cargo.toml**

Edit `app/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
win32job = "2"
which = "7"

[dependencies.windows]
version = "0.62"
features = [
    "Win32_Foundation",
    "Win32_System_Console",
    "Win32_System_Threading",
    "Win32_System_Pipes",
    "Win32_Security",
    "Win32_Storage_FileSystem",
]
```

- [ ] **Step 3: Add frontend dependencies**

```bash
cd D:/Projects/claude-code-launcher/app
npm install @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0 @xterm/addon-webgl@0.18.0
```

- [ ] **Step 4: Configure tauri.conf.json**

Edit `app/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Claude Launcher",
  "version": "1.0.0",
  "identifier": "com.claude-launcher.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "title": "Claude Launcher",
    "windows": [
      {
        "label": "main",
        "title": "Claude Launcher",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 500
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

- [ ] **Step 5: Create capabilities file**

Create `app/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "platforms": ["windows"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-close"
  ]
}
```

- [ ] **Step 6: Verify it builds**

```bash
cd D:/Projects/claude-code-launcher/app
npm run tauri dev
```

Expected: Tauri window opens with default React template. Close it.

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "feat: scaffold Tauri 2 + React + TypeScript project"
```

---

### Task 2: ConPTY wrapper module (pty.rs)

**Files:**
- Create: `app/src-tauri/src/pty.rs`

- [ ] **Step 1: Create the PTY module**

Create `app/src-tauri/src/pty.rs`:

```rust
use std::io::{self, Read, Write};
use std::mem::{size_of, zeroed};
use std::ptr;
use std::sync::{Arc, Mutex};
use std::thread;

use windows::Win32::Foundation::*;
use windows::Win32::System::Console::*;
use windows::Win32::System::Pipes::*;
use windows::Win32::System::Threading::*;

/// Represents a running pseudo-console session.
pub struct PtySession {
    pub hpc: HPCON,
    pub process_handle: HANDLE,
    pub thread_handle: HANDLE,
    pub input_write: HANDLE,
    pub output_read: HANDLE,
    pub pid: u32,
    _attr_list_buf: Vec<u8>,
}

// SAFETY: HANDLE and HPCON are thread-safe as long as we synchronize access.
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

fn create_pipe() -> io::Result<(HANDLE, HANDLE)> {
    let mut read_handle = HANDLE::default();
    let mut write_handle = HANDLE::default();
    unsafe {
        CreatePipe(&mut read_handle, &mut write_handle, None, 0)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    }
    Ok((read_handle, write_handle))
}

impl PtySession {
    /// Spawn a new process in a pseudo console.
    ///
    /// `command` is the full command line (e.g., `cmd.exe /c claude ...`).
    /// `working_dir` is the directory to start in.
    /// `env` is a list of `KEY=VALUE` pairs to set in the child environment.
    /// `cols` and `rows` are the initial terminal size.
    pub fn spawn(
        command: &str,
        working_dir: &str,
        env: &[(String, String)],
        cols: i16,
        rows: i16,
    ) -> io::Result<Self> {
        let (pty_input_read, pty_input_write) = create_pipe()?;
        let (pty_output_read, pty_output_write) = create_pipe()?;

        let size = COORD { X: cols, Y: rows };
        let hpc = unsafe {
            CreatePseudoConsole(size, pty_input_read, pty_output_write, 0)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?
        };

        // Close handles now owned by the PTY
        unsafe {
            let _ = CloseHandle(pty_input_read);
            let _ = CloseHandle(pty_output_write);
        }

        // Build attribute list
        let mut attr_list_size: usize = 0;
        let _ = unsafe {
            InitializeProcThreadAttributeList(
                LPPROC_THREAD_ATTRIBUTE_LIST(ptr::null_mut()),
                1,
                0,
                &mut attr_list_size,
            )
        };

        let mut attr_list_buf: Vec<u8> = vec![0u8; attr_list_size];
        let attr_list =
            LPPROC_THREAD_ATTRIBUTE_LIST(attr_list_buf.as_mut_ptr() as *mut _);

        unsafe {
            InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_list_size)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

            // PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
            UpdateProcThreadAttribute(
                attr_list,
                0,
                0x00020016,
                Some(hpc.0 as *const _),
                size_of::<HPCON>(),
                None,
                None,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }

        let mut si: STARTUPINFOEXW = unsafe { zeroed() };
        si.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        si.lpAttributeList = attr_list;

        let mut pi: PROCESS_INFORMATION = unsafe { zeroed() };

        // Build environment block
        let mut env_block = std::env::vars()
            .chain(env.iter().map(|(k, v)| (k.clone(), v.clone())))
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>();
        env_block.push(String::new()); // double-null terminator
        let env_str = env_block.join("\0");
        let env_wide: Vec<u16> = env_str.encode_utf16().chain(std::iter::once(0)).collect();

        // Build command line
        let mut cmd_wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();

        // Build working directory
        let work_dir_wide: Vec<u16> =
            working_dir.encode_utf16().chain(std::iter::once(0)).collect();

        unsafe {
            CreateProcessW(
                None,
                PWSTR(cmd_wide.as_mut_ptr()),
                None,
                None,
                false,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                Some(env_wide.as_ptr() as *const _),
                PCWSTR(work_dir_wide.as_ptr()),
                &si.StartupInfo as *const STARTUPINFOW,
                &mut pi,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }

        Ok(PtySession {
            hpc,
            process_handle: pi.hProcess,
            thread_handle: pi.hThread,
            input_write: pty_input_write,
            output_read: pty_output_read,
            pid: pi.dwProcessId,
            _attr_list_buf: attr_list_buf,
        })
    }

    /// Write data to the PTY input.
    pub fn write(&self, data: &[u8]) -> io::Result<()> {
        let mut written: u32 = 0;
        unsafe {
            WriteFile(self.input_write, Some(data), Some(&mut written), None)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }
        Ok(())
    }

    /// Read data from the PTY output. Blocks until data is available.
    pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        let mut bytes_read: u32 = 0;
        unsafe {
            ReadFile(self.output_read, Some(buf), Some(&mut bytes_read), None)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }
        Ok(bytes_read as usize)
    }

    /// Resize the pseudo console.
    pub fn resize(&self, cols: i16, rows: i16) -> io::Result<()> {
        unsafe {
            ResizePseudoConsole(self.hpc, COORD { X: cols, Y: rows })
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }
        Ok(())
    }

    /// Wait for the process to exit and return the exit code.
    pub fn wait_for_exit(&self) -> io::Result<i32> {
        unsafe {
            WaitForSingleObject(self.process_handle, INFINITE);
            let mut exit_code: u32 = 0;
            GetExitCodeProcess(self.process_handle, &mut exit_code)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            Ok(exit_code as i32)
        }
    }

    /// Kill the child process.
    pub fn kill(&self) {
        unsafe {
            let _ = TerminateProcess(self.process_handle, 1);
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        unsafe {
            ClosePseudoConsole(self.hpc);
            let _ = CloseHandle(self.process_handle);
            let _ = CloseHandle(self.thread_handle);
            let _ = CloseHandle(self.input_write);
            let _ = CloseHandle(self.output_read);
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Add `mod pty;` to `app/src-tauri/src/main.rs` (or `lib.rs`) temporarily, then:

```bash
cd D:/Projects/claude-code-launcher/app
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/src/pty.rs
git commit -m "feat: add ConPTY wrapper module (pty.rs)"
```

---

### Task 3: Session registry and Job Object (commands.rs)

**Files:**
- Create: `app/src-tauri/src/session.rs`

- [ ] **Step 1: Create session registry**

Create `app/src-tauri/src/session.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use serde::Serialize;
use uuid::Uuid;
use win32job::Job;

use crate::pty::PtySession;

const MAX_SESSIONS: usize = 10;
const OUTPUT_BATCH_MS: u64 = 16;
const MAX_WRITE_SIZE: usize = 65536; // 64KB

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PtyEvent {
    Output { data: Vec<u8> },
    Exit { code: i32 },
}

struct SessionEntry {
    pty: Arc<PtySession>,
    last_heartbeat: Instant,
}

pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionEntry>>,
    _job: Job, // kept alive for the lifetime of the app
}

impl SessionRegistry {
    pub fn new() -> Result<Self, String> {
        let job = Job::create().map_err(|e| format!("Failed to create Job Object: {e}"))?;
        let mut info = job
            .query_extended_limit_info()
            .map_err(|e| format!("Failed to query job info: {e}"))?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&mut info)
            .map_err(|e| format!("Failed to set job info: {e}"))?;
        job.assign_current_process()
            .map_err(|e| format!("Failed to assign process to job: {e}"))?;

        Ok(Self {
            sessions: Mutex::new(HashMap::new()),
            _job: job,
        })
    }

    /// Spawn a new Claude session. Returns the session ID.
    pub fn spawn(
        &self,
        command: &str,
        working_dir: &str,
        env: &[(String, String)],
        cols: i16,
        rows: i16,
        on_event: Channel<PtyEvent>,
    ) -> Result<String, String> {
        let mut sessions = self.sessions.lock().unwrap();
        if sessions.len() >= MAX_SESSIONS {
            return Err(format!("Maximum {MAX_SESSIONS} concurrent sessions reached"));
        }

        let pty = PtySession::spawn(command, working_dir, env, cols, rows)
            .map_err(|e| format!("Failed to spawn PTY: {e}"))?;
        let pty = Arc::new(pty);

        let session_id = Uuid::new_v4().to_string();

        // Start output reader thread with real batching (16ms window)
        let pty_reader = Arc::clone(&pty);
        let channel = on_event.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut accum: Vec<u8> = Vec::with_capacity(8192);
            let mut last_flush = Instant::now();
            loop {
                match pty_reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        accum.extend_from_slice(&buf[..n]);
                        if last_flush.elapsed() >= Duration::from_millis(OUTPUT_BATCH_MS)
                            || accum.len() >= 8192
                        {
                            let data = std::mem::take(&mut accum);
                            if channel.send(PtyEvent::Output { data }).is_err() {
                                break;
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }
            // Flush remaining data
            if !accum.is_empty() {
                let _ = channel.send(PtyEvent::Output { data: accum });
            }
        });

        // Start exit watcher thread
        let pty_waiter = Arc::clone(&pty);
        let exit_channel = on_event;
        thread::spawn(move || {
            let code = pty_waiter.wait_for_exit().unwrap_or(-1);
            let _ = exit_channel.send(PtyEvent::Exit { code });
        });

        sessions.insert(
            session_id.clone(),
            SessionEntry {
                pty,
                last_heartbeat: Instant::now(),
            },
        );

        Ok(session_id)
    }

    /// Write data to a session's PTY.
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        if data.len() > MAX_WRITE_SIZE {
            return Err(format!("Write size {} exceeds max {MAX_WRITE_SIZE}", data.len()));
        }
        let sessions = self.sessions.lock().unwrap();
        let entry = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {session_id} not found"))?;
        entry
            .pty
            .write(data)
            .map_err(|e| format!("Write failed: {e}"))
    }

    /// Resize a session's PTY.
    pub fn resize(&self, session_id: &str, cols: i16, rows: i16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let entry = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {session_id} not found"))?;
        entry
            .pty
            .resize(cols, rows)
            .map_err(|e| format!("Resize failed: {e}"))
    }

    /// Kill a session and remove it from the registry.
    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.remove(session_id) {
            entry.pty.kill();
            Ok(())
        } else {
            Err(format!("Session {session_id} not found"))
        }
    }

    /// Update heartbeat for a session.
    pub fn heartbeat(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get_mut(session_id) {
            entry.last_heartbeat = Instant::now();
            Ok(())
        } else {
            Err(format!("Session {session_id} not found"))
        }
    }

    /// Get the number of active sessions.
    pub fn active_count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }

    /// Kill all sessions (used during app shutdown).
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, entry) in sessions.drain() {
            entry.pty.kill();
        }
    }

    /// Start background reaper thread that kills sessions with stale heartbeats.
    /// Call once after creating the registry.
    pub fn start_reaper(self: &Arc<Self>) {
        let registry = Arc::clone(self);
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(10));
                let mut sessions = registry.sessions.lock().unwrap();
                let stale: Vec<String> = sessions
                    .iter()
                    .filter(|(_, entry)| entry.last_heartbeat.elapsed() > Duration::from_secs(30))
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in stale {
                    if let Some(entry) = sessions.remove(&id) {
                        entry.pty.kill();
                    }
                }
            }
        });
    }
}
```

- [ ] **Step 2: Verify it compiles**

Add `mod session;` to main, then:

```bash
cd D:/Projects/claude-code-launcher/app
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src-tauri/src/session.rs
git commit -m "feat: add session registry with Job Object cleanup"
```

---

### Task 4: Projects and settings I/O (projects.rs)

**Files:**
- Create: `app/src-tauri/src/projects.rs`

- [ ] **Step 1: Create the projects module**

Create `app/src-tauri/src/projects.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_PROJECTS_DIR: &str = r"D:\Projects";

// ── Settings ──────────────────────────────────────────────

/// Settings struct uses snake_case for JSON file compatibility with Python launcher.
/// The Tauri IPC also sends snake_case — TypeScript side must match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub model_idx: usize,
    #[serde(default)]
    pub effort_idx: usize,
    #[serde(default)]
    pub sort_idx: usize,
    #[serde(default)]
    pub skip_perms: bool,
    #[serde(default = "default_project_dirs")]
    pub project_dirs: Vec<String>,
    #[serde(default)]
    pub project_labels: HashMap<String, String>,
    /// Preserve unknown keys for forward-compatibility
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

fn default_project_dirs() -> Vec<String> {
    let dir = std::env::var("CLAUDE_LAUNCHER_PROJECTS_DIR")
        .unwrap_or_else(|_| DEFAULT_PROJECTS_DIR.to_string());
    vec![dir]
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            model_idx: 0,
            effort_idx: 0,
            sort_idx: 0,
            skip_perms: false,
            project_dirs: default_project_dirs(),
            project_labels: HashMap::new(),
            extra: HashMap::new(),
        }
    }
}

// ── Usage ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEntry {
    pub last_used: f64,
    pub count: u64,
}

pub type UsageData = HashMap<String, UsageEntry>;

// ── Project Info ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub label: Option<String>,
    pub branch: Option<String>,
    pub is_dirty: bool,
    pub has_claude_md: bool,
}

// ── Data directory resolution ──────────────────────────────

pub fn data_dir() -> PathBuf {
    // Use executable directory, matching Python launcher's _SCRIPT_DIR
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn settings_path() -> PathBuf {
    data_dir().join("claude-launcher-settings.json")
}

fn settings_bak_path() -> PathBuf {
    data_dir().join("claude-launcher-settings.json.bak")
}

fn usage_path() -> PathBuf {
    data_dir().join("claude-launcher-usage.json")
}

// ── Settings I/O ──────────────────────────────────────────

pub fn load_settings() -> Settings {
    if let Ok(data) = fs::read_to_string(settings_path()) {
        if let Ok(s) = serde_json::from_str(&data) {
            return s;
        }
    }
    // Try backup
    if let Ok(data) = fs::read_to_string(settings_bak_path()) {
        if let Ok(s) = serde_json::from_str(&data) {
            return s;
        }
    }
    Settings::default()
}

pub fn save_settings(settings: &Settings) -> io::Result<()> {
    let path = settings_path();
    let tmp = path.with_extension("json.tmp");
    let bak = settings_bak_path();

    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    fs::write(&tmp, &data)?;

    // Backup existing file
    if path.exists() {
        let _ = fs::copy(&path, &bak);
    }

    fs::rename(&tmp, &path)?;
    Ok(())
}

// ── Usage I/O ──────────────────────────────────────────

pub fn load_usage() -> UsageData {
    if let Ok(data) = fs::read_to_string(usage_path()) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

pub fn save_usage(usage: &UsageData) -> io::Result<()> {
    let path = usage_path();
    let tmp = path.with_extension("json.tmp");

    let data = serde_json::to_string_pretty(usage)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn record_usage(project_path: &str) -> io::Result<()> {
    let mut usage = load_usage();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();

    let entry = usage
        .entry(project_path.to_string())
        .or_insert(UsageEntry {
            last_used: 0.0,
            count: 0,
        });
    entry.last_used = now;
    entry.count += 1;

    save_usage(&usage)
}

// ── Project scanning ──────────────────────────────────────

fn scan_one_project(path: &str, label: Option<&String>) -> Option<ProjectInfo> {
    let p = Path::new(path);
    if !p.is_dir() {
        return None;
    }

    let name = p.file_name()?.to_string_lossy().to_string();

    let has_claude_md = p.join("CLAUDE.md").exists();

    // git status --branch --porcelain=v2 (2s timeout)
    let (branch, is_dirty) = match Command::new("git")
        .args(["status", "--branch", "--porcelain=v2"])
        .current_dir(path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .and_then(|child| {
            let output = child.wait_with_output();
            // Note: wait_with_output doesn't have a timeout.
            // For a proper 2s timeout, wrap with tokio::time::timeout
            // or use a thread with recv_timeout. Simplified here.
            output
        })
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let branch = stdout
                .lines()
                .find(|l| l.starts_with("# branch.head "))
                .map(|l| l.trim_start_matches("# branch.head ").to_string());
            let dirty = stdout.lines().any(|l| !l.starts_with('#'));
            (branch, dirty)
        }
        _ => (None, false),
    };

    Some(ProjectInfo {
        path: path.to_string(),
        name,
        label: label.cloned(),
        branch,
        is_dirty,
        has_claude_md,
    })
}

pub fn scan_projects(project_dirs: &[String], labels: &HashMap<String, String>) -> Vec<ProjectInfo> {
    // Each dir in project_dirs IS a project (not a parent containing subdirs)
    // Scan in parallel
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();

    for dir in project_dirs {
        let dir = dir.clone();
        let label = labels.get(&dir).cloned();
        let tx = tx.clone();
        thread::spawn(move || {
            if let Some(info) = scan_one_project(&dir, label.as_ref()) {
                let _ = tx.send(info);
            }
        });
    }

    drop(tx);
    rx.iter().collect()
}

// ── Project creation ──────────────────────────────────────

/// Sanitize a string by removing ANSI escape sequences.
pub fn safe_str(s: &str) -> String {
    let re = regex_lite::Regex::new(r"\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)").unwrap();
    re.replace_all(s, "").to_string()
}

/// Reject UNC paths.
pub fn is_unc(path: &str) -> bool {
    path.starts_with(r"\\")
}

pub fn create_project(parent: &str, name: &str, git_init: bool) -> Result<String, String> {
    if is_unc(parent) {
        return Err("UNC paths are not supported".to_string());
    }

    let sanitized = safe_str(name);
    if sanitized.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    // Path traversal check
    let project_path = Path::new(parent).join(&sanitized);
    let canonical_parent = Path::new(parent)
        .canonicalize()
        .map_err(|e| format!("Invalid parent directory: {e}"))?;
    // Check the new path would be inside the parent
    if !project_path.starts_with(&canonical_parent) {
        return Err("Path traversal detected".to_string());
    }

    fs::create_dir_all(&project_path)
        .map_err(|e| format!("Failed to create directory: {e}"))?;

    if git_init {
        Command::new("git")
            .args(["init"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("git init failed: {e}"))?;
    }

    Ok(project_path.to_string_lossy().to_string())
}
```

- [ ] **Step 2: Add regex-lite to Cargo.toml**

Add to `app/src-tauri/Cargo.toml` dependencies:

```toml
regex-lite = "0.1"
```

- [ ] **Step 3: Verify it compiles**

```bash
cd D:/Projects/claude-code-launcher/app
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/projects.rs app/src-tauri/Cargo.toml
git commit -m "feat: add projects module (scan, settings, usage I/O)"
```

---

### Task 5: Claude executable resolution (claude.rs)

**Files:**
- Create: `app/src-tauri/src/claude.rs`

- [ ] **Step 1: Create the Claude module**

Create `app/src-tauri/src/claude.rs`:

```rust
use std::path::PathBuf;

const MODELS: &[(&str, &str)] = &[
    ("sonnet", "claude-sonnet-4-6"),
    ("opus", "claude-opus-4-6"),
    ("haiku", "claude-haiku-4-5"),
    ("sonnet [1M]", "claude-sonnet-4-6[1m]"),
    ("opus [1M]", "claude-opus-4-6[1m]"),
];

const EFFORTS: &[&str] = &["high", "medium", "low"];

/// Resolve the Claude executable path.
pub fn resolve_claude_exe() -> Result<PathBuf, String> {
    // 1. Search PATH
    if let Ok(path) = which::which("claude") {
        return Ok(path);
    }

    // 2. Fallback: ~/.local/bin/claude.exe
    if let Some(home) = dirs::home_dir() {
        let fallback = home.join(".local").join("bin").join("claude.exe");
        if fallback.exists() {
            return Ok(fallback);
        }
    }

    Err("Claude executable not found. Install with: npm install -g @anthropic-ai/claude-code".to_string())
}

/// Build the full command line to spawn Claude.
///
/// Returns `(program, args)` — handles .cmd/.bat shims by routing through cmd.exe.
pub fn build_command(
    claude_exe: &PathBuf,
    project_path: &str,
    model_idx: usize,
    effort_idx: usize,
    skip_perms: bool,
) -> (String, Vec<String>) {
    let model_id = MODELS
        .get(model_idx)
        .map(|(_, id)| *id)
        .unwrap_or(MODELS[0].1);

    let effort = EFFORTS
        .get(effort_idx)
        .copied()
        .unwrap_or(EFFORTS[0]);

    let exe_str = claude_exe.to_string_lossy().to_string();
    let is_shim = exe_str.ends_with(".cmd") || exe_str.ends_with(".bat");

    let mut claude_args = vec![
        "--model".to_string(),
        model_id.to_string(),
        "--effort".to_string(),
        effort.to_string(),
    ];

    if skip_perms {
        claude_args.push("--dangerously-skip-permissions".to_string());
    }

    if is_shim {
        // Route through cmd.exe /c for .cmd/.bat shims
        let mut args = vec!["/c".to_string(), exe_str];
        args.extend(claude_args);
        ("cmd.exe".to_string(), args)
    } else {
        (exe_str, claude_args)
    }
}

/// Environment variables to set before spawning Claude.
pub fn claude_env() -> Vec<(String, String)> {
    vec![
        ("CLAUDE_CODE_MAX_OUTPUT_TOKENS".to_string(), "64000".to_string()),
    ]
}

/// Get model display name by index.
pub fn model_name(idx: usize) -> &'static str {
    MODELS.get(idx).map(|(name, _)| *name).unwrap_or(MODELS[0].0)
}

/// Get model ID by index.
pub fn model_id(idx: usize) -> &'static str {
    MODELS.get(idx).map(|(_, id)| *id).unwrap_or(MODELS[0].1)
}
```

- [ ] **Step 2: Add dirs crate to Cargo.toml**

Add to `app/src-tauri/Cargo.toml` dependencies:

```toml
dirs = "6"
```

- [ ] **Step 3: Verify it compiles**

```bash
cd D:/Projects/claude-code-launcher/app
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/claude.rs app/src-tauri/Cargo.toml
git commit -m "feat: add Claude executable resolution module"
```

---

### Task 6: Tauri IPC commands (commands.rs) and main.rs

**Files:**
- Create: `app/src-tauri/src/commands.rs`
- Modify: `app/src-tauri/src/main.rs` (or `lib.rs`)

- [ ] **Step 1: Create the commands module**

Create `app/src-tauri/src/commands.rs`:

```rust
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::claude;
use crate::projects::{self, ProjectInfo, Settings, UsageData};
use crate::session::{PtyEvent, SessionRegistry};

#[tauri::command]
pub async fn spawn_claude(
    registry: State<'_, Arc<SessionRegistry>>,
    project_path: String,
    model_idx: usize,
    effort_idx: usize,
    skip_perms: bool,
    cols: i16,
    rows: i16,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let claude_exe = claude::resolve_claude_exe()?;
    let (program, args) = claude::build_command(&claude_exe, &project_path, model_idx, effort_idx, skip_perms);

    // Build full command line string
    let mut cmd_parts = vec![program];
    cmd_parts.extend(args);
    let command_line = cmd_parts.join(" ");

    let env = claude::claude_env();

    registry.spawn(&command_line, &project_path, &env, cols, rows, on_event)
}

#[tauri::command]
pub async fn write_pty(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    registry.write(&session_id, &data)
}

#[tauri::command]
pub async fn resize_pty(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    cols: i16,
    rows: i16,
) -> Result<(), String> {
    registry.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn kill_session(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
) -> Result<(), String> {
    registry.kill(&session_id)
}

#[tauri::command]
pub async fn heartbeat(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
) -> Result<(), String> {
    registry.heartbeat(&session_id)
}

#[tauri::command]
pub async fn active_session_count(
    registry: State<'_, Arc<SessionRegistry>>,
) -> Result<usize, String> {
    Ok(registry.active_count())
}

#[tauri::command]
pub async fn scan_projects(
    project_dirs: Vec<String>,
    labels: std::collections::HashMap<String, String>,
) -> Result<Vec<ProjectInfo>, String> {
    Ok(projects::scan_projects(&project_dirs, &labels))
}

#[tauri::command]
pub async fn load_settings() -> Result<Settings, String> {
    Ok(projects::load_settings())
}

#[tauri::command]
pub async fn save_settings(settings: Settings) -> Result<(), String> {
    projects::save_settings(&settings).map_err(|e| format!("Failed to save settings: {e}"))
}

#[tauri::command]
pub async fn load_usage() -> Result<UsageData, String> {
    Ok(projects::load_usage())
}

#[tauri::command]
pub async fn record_usage(project_path: String) -> Result<(), String> {
    projects::record_usage(&project_path).map_err(|e| format!("Failed to record usage: {e}"))
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open explorer: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn create_project(
    parent: String,
    name: String,
    git_init: bool,
) -> Result<String, String> {
    projects::create_project(&parent, &name, git_init)
}
```

- [ ] **Step 2: Wire everything in main.rs**

Replace `app/src-tauri/src/main.rs` (or `lib.rs` depending on scaffold) with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod commands;
mod projects;
mod pty;
mod session;

use std::sync::Arc;
use session::SessionRegistry;

fn main() {
    let registry = Arc::new(
        SessionRegistry::new().expect("Failed to create session registry"),
    );

    // Start heartbeat reaper to clean up stale sessions
    registry.start_reaper();

    let registry_for_cleanup = Arc::clone(&registry);

    tauri::Builder::default()
        .manage(registry)
        .invoke_handler(tauri::generate_handler![
            commands::spawn_claude,
            commands::write_pty,
            commands::resize_pty,
            commands::kill_session,
            commands::heartbeat,
            commands::active_session_count,
            commands::scan_projects,
            commands::load_settings,
            commands::save_settings,
            commands::load_usage,
            commands::record_usage,
            commands::open_in_explorer,
            commands::create_project,
        ])
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                registry_for_cleanup.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Update build.rs**

Replace `app/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd D:/Projects/claude-code-launcher/app
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/
git commit -m "feat: add Tauri IPC commands and wire up main.rs"
```

---

## Chunk 2: React Frontend — Core Structure

### Task 7: App shell and tab state management

**Files:**
- Create: `app/src/types.ts`
- Modify: `app/src/App.tsx`
- Create: `app/src/hooks/useTabManager.ts`

- [ ] **Step 1: Create shared types**

Create `app/src/types.ts`:

```typescript
export interface Tab {
  id: string;
  type: "new-tab" | "terminal";
  projectPath?: string;
  projectName?: string;
  modelIdx?: number;
  effortIdx?: number;
  skipPerms?: boolean;
  sessionId?: string;
  hasNewOutput?: boolean;
  exitCode?: number | null;
}

export interface ProjectInfo {
  path: string;
  name: string;
  label: string | null;
  branch: string | null;
  isDirty: boolean;
  hasClaudeMd: boolean;
}

// Snake_case to match Rust serde and Python launcher JSON format
export interface Settings {
  version?: number;
  model_idx: number;
  effort_idx: number;
  sort_idx: number;
  skip_perms: boolean;
  project_dirs: string[];
  project_labels: Record<string, string>;
}

export interface UsageEntry {
  lastUsed: number;
  count: number;
}

export type UsageData = Record<string, UsageEntry>;

export const MODELS = [
  { display: "sonnet", id: "claude-sonnet-4-6" },
  { display: "opus", id: "claude-opus-4-6" },
  { display: "haiku", id: "claude-haiku-4-5" },
  { display: "sonnet [1M]", id: "claude-sonnet-4-6[1m]" },
  { display: "opus [1M]", id: "claude-opus-4-6[1m]" },
] as const;

export const EFFORTS = ["high", "medium", "low"] as const;
export const SORT_ORDERS = ["alpha", "last used", "most used"] as const;
```

- [ ] **Step 2: Create tab manager hook**

Create `app/src/hooks/useTabManager.ts`:

```typescript
import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tab } from "../types";

function createNewTab(): Tab {
  return {
    id: crypto.randomUUID(),
    type: "new-tab",
    hasNewOutput: false,
    exitCode: null,
  };
}

export function useTabManager() {
  const [tabs, setTabs] = useState<Tab[]>([createNewTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const addTab = useCallback(() => {
    const tab = createNewTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;

        const next = prev.filter((t) => t.id !== tabId);

        if (next.length === 0) {
          // Last tab — close the app
          getCurrentWindow().close();
          return prev;
        }

        // If closing active tab, switch to nearest
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        }

        return next;
      });
    },
    [activeTabId],
  );

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    );
  }, []);

  const activateTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      // Clear new output indicator
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, hasNewOutput: false } : t,
        ),
      );
    },
    [],
  );

  const nextTab = useCallback(() => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      const next = (idx + 1) % prev.length;
      setActiveTabId(prev[next].id);
      return prev.map((t) =>
        t.id === prev[next].id ? { ...t, hasNewOutput: false } : t,
      );
    });
  }, [activeTabId]);

  const prevTab = useCallback(() => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      const next = (idx - 1 + prev.length) % prev.length;
      setActiveTabId(prev[next].id);
      return prev.map((t) =>
        t.id === prev[next].id ? { ...t, hasNewOutput: false } : t,
      );
    });
  }, [activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return {
    tabs,
    activeTab,
    activeTabId,
    addTab,
    closeTab,
    updateTab,
    activateTab,
    nextTab,
    prevTab,
  };
}
```

- [ ] **Step 3: Create App.tsx shell**

Replace `app/src/App.tsx`:

```tsx
import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTabManager } from "./hooks/useTabManager";
import TabBar from "./components/TabBar";
import Terminal from "./components/Terminal";
import NewTabPage from "./components/NewTabPage";
import "./App.css";

function App() {
  const {
    tabs,
    activeTab,
    activeTabId,
    addTab,
    closeTab,
    updateTab,
    activateTab,
    nextTab,
    prevTab,
  } = useTabManager();

  // Update window title based on active tab
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const terminalCount = tabs.filter((t) => t.type === "terminal").length;

    if (activeTab.type === "terminal" && activeTab.projectName) {
      const suffix = terminalCount > 1 ? ` (+${terminalCount - 1} tabs)` : "";
      appWindow.setTitle(`Claude Launcher — ${activeTab.projectName}${suffix}`);
    } else {
      appWindow.setTitle("Claude Launcher");
    }
  }, [activeTab, tabs]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        addTab();
      } else if (e.ctrlKey && e.key === "F4") {
        e.preventDefault();
        closeTab(activeTabId);
      } else if (e.ctrlKey && !e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        nextTab();
      } else if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        prevTab();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addTab, closeTab, activeTabId, nextTab, prevTab]);

  const handleLaunch = useCallback(
    (tabId: string, projectPath: string, projectName: string, modelIdx: number, effortIdx: number, skipPerms: boolean) => {
      updateTab(tabId, {
        type: "terminal",
        projectPath,
        projectName,
        modelIdx,
      });
    },
    [updateTab],
  );

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onAdd={addTab}
      />
      <div className="tab-content">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tab-panel"
            style={{ display: tab.id === activeTabId ? "flex" : "none" }}
          >
            {tab.type === "new-tab" ? (
              <NewTabPage
                tabId={tab.id}
                onLaunch={handleLaunch}
                onRequestClose={() => closeTab(tab.id)}
                isActive={tab.id === activeTabId}
              />
            ) : (
              <Terminal
                tabId={tab.id}
                projectPath={tab.projectPath!}
                modelIdx={tab.modelIdx!}
                effortIdx={tab.effortIdx ?? 0}
                skipPerms={tab.skipPerms ?? false}
                isActive={tab.id === activeTabId}
                onSessionCreated={(sessionId) => updateTab(tab.id, { sessionId })}
                onNewOutput={() => {
                  if (tab.id !== activeTabId) {
                    updateTab(tab.id, { hasNewOutput: true });
                  }
                }}
                onExit={(code) => updateTab(tab.id, { exitCode: code })}
                onError={(msg) => console.error(`Tab ${tab.id} error:`, msg)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 4: Create App.css**

Replace `app/src/App.css`:

```css
:root {
  --bg: #1e1e2e;
  --surface: #313244;
  --text: #cdd6f4;
  --text-dim: #6c7086;
  --accent: #89b4fa;
  --red: #f38ba8;
  --green: #a6e3a1;
  --yellow: #f9e2af;
  --tab-height: 36px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.tab-panel {
  position: absolute;
  inset: 0;
  flex-direction: column;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/src/
git commit -m "feat: add App shell, tab manager, types, and base styles"
```

---

### Task 8: TabBar component

**Files:**
- Create: `app/src/components/TabBar.tsx`

- [ ] **Step 1: Create TabBar**

Create `app/src/components/TabBar.tsx`:

```tsx
import { Tab, MODELS } from "../types";
import "./TabBar.css";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

export default function TabBar({ tabs, activeTabId, onActivate, onClose, onAdd }: TabBarProps) {
  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const label =
            tab.type === "terminal"
              ? `${tab.projectName ?? "Terminal"}${tab.modelIdx != null ? ` — ${MODELS[tab.modelIdx].display}` : ""}`
              : "New Tab";

          return (
            <div
              key={tab.id}
              className={`tab ${isActive ? "active" : ""} ${tab.hasNewOutput ? "has-output" : ""}`}
              onClick={() => onActivate(tab.id)}
            >
              <span className="tab-label">{label}</span>
              {tab.exitCode != null && (
                <span className={`tab-exit ${tab.exitCode === 0 ? "ok" : "err"}`}>
                  {tab.exitCode === 0 ? "✓" : "✗"}
                </span>
              )}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                title="Close (Ctrl+F4)"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button className="tab-add" onClick={onAdd} title="New Tab (Ctrl+T)">
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create TabBar.css**

Create `app/src/components/TabBar.css`:

```css
.tab-bar {
  display: flex;
  align-items: center;
  background: #181825;
  height: var(--tab-height);
  padding: 0 4px;
  gap: 2px;
  -webkit-app-region: drag;
  user-select: none;
}

.tab-list {
  display: flex;
  flex: 1;
  overflow-x: auto;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.tab-list::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 28px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
  max-width: 200px;
  transition: background 0.1s;
}

.tab:hover {
  background: var(--surface);
}

.tab.active {
  background: var(--bg);
  color: var(--text);
}

.tab.has-output::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}

.tab-exit {
  font-size: 10px;
  flex-shrink: 0;
}

.tab-exit.ok {
  color: var(--green);
}

.tab-exit.err {
  color: var(--red);
}

.tab-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 3px;
  flex-shrink: 0;
}

.tab-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.tab-add {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 18px;
  padding: 0 8px;
  height: 28px;
  border-radius: 4px;
  -webkit-app-region: no-drag;
}

.tab-add:hover {
  background: var(--surface);
  color: var(--text);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/TabBar.tsx app/src/components/TabBar.css
git commit -m "feat: add TabBar component"
```

---

### Task 9: Terminal component (xterm.js wrapper)

**Files:**
- Create: `app/src/components/Terminal.tsx`
- Create: `app/src/hooks/usePty.ts`

- [ ] **Step 1: Create PTY hook**

Create `app/src/hooks/usePty.ts`:

```typescript
import { useEffect, useRef, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";

type PtyEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number };

/**
 * Spawn a Claude session and return sessionId.
 * The Channel is created here and routes events to the provided callbacks.
 * The caller (Terminal component) owns the Channel lifecycle.
 */
export async function spawnClaude(
  projectPath: string,
  modelIdx: number,
  effortIdx: number,
  skipPerms: boolean,
  cols: number,
  rows: number,
  onOutput: (data: Uint8Array) => void,
  onExit: (code: number) => void,
): Promise<string> {
  const onEvent = new Channel<PtyEvent>();
  onEvent.onmessage = (msg) => {
    if (msg.type === "output") {
      onOutput(new Uint8Array(msg.data));
    } else if (msg.type === "exit") {
      onExit(msg.code);
    }
  };

  const sessionId = await invoke<string>("spawn_claude", {
    projectPath,
    model_idx: modelIdx,
    effort_idx: effortIdx,
    skip_perms: skipPerms,
    cols,
    rows,
    onEvent,
  });

  return sessionId;
}

/** Write data to a PTY session. */
export async function writePty(sessionId: string, data: string): Promise<void> {
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(data));
  await invoke("write_pty", { sessionId, data: bytes });
}

/** Resize a PTY session. */
export async function resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  await invoke("resize_pty", { sessionId, cols, rows });
}

/** Kill a PTY session. */
export async function killSession(sessionId: string): Promise<void> {
  await invoke("kill_session", { sessionId });
}

/** Send heartbeat for a session. */
export async function sendHeartbeat(sessionId: string): Promise<void> {
  await invoke("heartbeat", { sessionId });
}
```

- [ ] **Step 2: Create Terminal component**

Create `app/src/components/Terminal.tsx`:

The Terminal component **owns** the PTY spawn and Channel lifecycle. It calls `spawnClaude` on mount and routes output directly to xterm.js. This avoids the Channel disconnection issue.

```tsx
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { spawnClaude, writePty, resizePty, sendHeartbeat } from "../hooks/usePty";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  tabId: string;
  projectPath: string;
  modelIdx: number;
  effortIdx: number;
  skipPerms: boolean;
  isActive: boolean;
  onSessionCreated: (sessionId: string) => void;
  onNewOutput: () => void;
  onExit: (code: number) => void;
  onError: (msg: string) => void;
}

export default function Terminal({
  tabId,
  projectPath,
  modelIdx,
  effortIdx,
  skipPerms,
  isActive,
  onSessionCreated,
  onNewOutput,
  onExit,
  onError,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const exitedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);

  // Keep isActive ref in sync to avoid stale closures
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Initialize xterm and spawn Claude
  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#45475a",
      },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    // WebGL with fallback
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      xterm.loadAddon(webglAddon);
    } catch {
      // Canvas renderer fallback
    }

    fitAddon.fit();

    // Intercept only global shortcuts, let everything else through
    xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && !event.shiftKey && event.key === "t") return false;
      if (event.ctrlKey && event.key === "F4") return false;
      if (event.ctrlKey && event.key === "Tab") return false;
      return true;
    });

    // Forward input to PTY
    xterm.onData((data) => {
      if (exitedRef.current || !sessionIdRef.current) return;
      writePty(sessionIdRef.current, data);
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Resize observer
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (sessionIdRef.current) {
        resizePty(sessionIdRef.current, xterm.cols, xterm.rows);
      }
    });
    observer.observe(containerRef.current);

    // Spawn Claude — Terminal owns the Channel
    const cols = xterm.cols;
    const rows = xterm.rows;

    spawnClaude(
      projectPath,
      modelIdx,
      effortIdx,
      skipPerms,
      cols,
      rows,
      // onOutput: write directly to xterm
      (data: Uint8Array) => {
        xtermRef.current?.write(data);
        if (!isActiveRef.current) {
          onNewOutput();
        }
      },
      // onExit
      (code: number) => {
        exitedRef.current = true;
        xtermRef.current?.write(
          `\r\n\x1b[90m[Claude exited with code ${code}. Press any key to close tab]\x1b[0m`,
        );
        onExit(code);
      },
    ).then((sessionId) => {
      sessionIdRef.current = sessionId;
      onSessionCreated(sessionId);
    }).catch((err) => {
      onError(String(err));
      xtermRef.current?.write(`\r\n\x1b[91mError: ${err}\x1b[0m`);
    });

    // Heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (sessionIdRef.current) {
        sendHeartbeat(sessionIdRef.current);
      }
    }, 5000);

    return () => {
      clearInterval(heartbeatInterval);
      observer.disconnect();
      xterm.dispose();
    };
  }, []); // mount once

  // Re-fit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      fitAddonRef.current.fit();
      xtermRef.current?.focus();
    }
  }, [isActive]);

  return <div ref={containerRef} className="terminal-container" />;
}
```

- [ ] **Step 3: Create Terminal.css**

Create `app/src/components/Terminal.css`:

```css
.terminal-container {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-container .xterm {
  height: 100%;
  padding: 4px;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/Terminal.tsx app/src/components/Terminal.css app/src/hooks/usePty.ts
git commit -m "feat: add Terminal component with xterm.js and PTY hook"
```

---

## Chunk 3: New-Tab Page (Project List & Controls)

### Task 10: Projects hook

**Files:**
- Create: `app/src/hooks/useProjects.ts`

- [ ] **Step 1: Create the projects hook**

Create `app/src/hooks/useProjects.ts`:

```typescript
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectInfo, Settings, UsageData, SORT_ORDERS } from "../types";

export function useProjects() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<UsageData>({});
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  // Load initial data
  useEffect(() => {
    async function load() {
      try {
        const [s, u] = await Promise.all([
          invoke<Settings>("load_settings"),
          invoke<UsageData>("load_usage"),
        ]);
        setSettings(s);
        setUsage(u);

        const projs = await invoke<ProjectInfo[]>("scan_projects", {
          project_dirs: s.project_dirs,
          labels: s.project_labels,
        });
        setProjects(projs);
      } catch (err) {
        console.error("Failed to load projects:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Save settings whenever they change
  const updateSettings = useCallback(
    async (updates: Partial<Settings>) => {
      if (!settings) return;
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      await invoke("save_settings", { settings: newSettings });
    },
    [settings],
  );

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    if (!settings) return [];

    let list = projects;

    // Filter
    if (filter) {
      const lower = filter.toLowerCase();
      list = list.filter((p) => {
        const name = (p.label ?? p.name).toLowerCase();
        return name.includes(lower);
      });
    }

    // Sort
    const sortOrder = SORT_ORDERS[settings.sort_idx] ?? "alpha";
    if (sortOrder === "alpha") {
      list = [...list].sort((a, b) =>
        (a.label ?? a.name).localeCompare(b.label ?? b.name),
      );
    } else if (sortOrder === "last used") {
      list = [...list].sort((a, b) => {
        const aUsage = usage[a.path]?.lastUsed ?? 0;
        const bUsage = usage[b.path]?.lastUsed ?? 0;
        return bUsage - aUsage;
      });
    } else if (sortOrder === "most used") {
      // Weight by recency with 30-day half-life decay
      const HALF_LIFE = 30 * 24 * 3600;
      const now = Date.now() / 1000;
      list = [...list].sort((a, b) => {
        const aEntry = usage[a.path];
        const bEntry = usage[b.path];
        const aWeight = aEntry
          ? aEntry.count * Math.pow(0.5, (now - aEntry.lastUsed) / HALF_LIFE)
          : 0;
        const bWeight = bEntry
          ? bEntry.count * Math.pow(0.5, (now - bEntry.lastUsed) / HALF_LIFE)
          : 0;
        return bWeight - aWeight;
      });
    }

    return list;
  }, [projects, filter, settings, usage]);

  const refresh = useCallback(async () => {
    if (!settings) return;
    setLoading(true);
    const projs = await invoke<ProjectInfo[]>("scan_projects", {
      project_dirs: settings.project_dirs,
      labels: settings.project_labels,
    });
    setProjects(projs);
    setLoading(false);
  }, [settings]);

  const recordUsage = useCallback(async (projectPath: string) => {
    await invoke("record_usage", { projectPath });
    const u = await invoke<UsageData>("load_usage");
    setUsage(u);
  }, []);

  return {
    settings,
    projects: filteredProjects,
    loading,
    filter,
    setFilter,
    updateSettings,
    refresh,
    recordUsage,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/hooks/useProjects.ts
git commit -m "feat: add useProjects hook with filter, sort, and settings"
```

---

### Task 11: ProjectList component

**Files:**
- Create: `app/src/components/ProjectList.tsx`
- Create: `app/src/components/ProjectList.css`

- [ ] **Step 1: Create ProjectList**

Create `app/src/components/ProjectList.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { ProjectInfo } from "../types";
import "./ProjectList.css";

interface ProjectListProps {
  projects: ProjectInfo[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  onActivate: (project: ProjectInfo) => void;
  loading: boolean;
}

export default function ProjectList({
  projects,
  selectedIdx,
  onSelect,
  onActivate,
  loading,
}: ProjectListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  if (loading) {
    return <div className="project-list-loading">Scanning projects...</div>;
  }

  if (projects.length === 0) {
    return <div className="project-list-empty">No projects found</div>;
  }

  return (
    <div className="project-list" ref={listRef}>
      {projects.map((project, idx) => (
        <div
          key={project.path}
          className={`project-item ${idx === selectedIdx ? "selected" : ""}`}
          onClick={() => onSelect(idx)}
          onDoubleClick={() => onActivate(project)}
        >
          <div className="project-main">
            <span className="project-name">{project.label ?? project.name}</span>
            {project.hasClaudeMd && <span className="project-badge claude">MD</span>}
          </div>
          <div className="project-meta">
            {project.branch && (
              <span className={`project-branch ${project.isDirty ? "dirty" : ""}`}>
                {project.branch}
                {project.isDirty ? " *" : ""}
              </span>
            )}
            <span className="project-path">{project.path}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectList.css**

Create `app/src/components/ProjectList.css`:

```css
.project-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.project-list-loading,
.project-list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
}

.project-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.project-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.project-item.selected {
  background: var(--surface);
}

.project-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-name {
  font-weight: 500;
  font-size: 13px;
}

.project-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
}

.project-badge.claude {
  background: rgba(137, 180, 250, 0.2);
  color: var(--accent);
}

.project-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-dim);
}

.project-branch {
  color: var(--green);
}

.project-branch.dirty {
  color: var(--yellow);
}

.project-path {
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/ProjectList.tsx app/src/components/ProjectList.css
git commit -m "feat: add ProjectList component"
```

---

### Task 12: StatusBar component

**Files:**
- Create: `app/src/components/StatusBar.tsx`
- Create: `app/src/components/StatusBar.css`

- [ ] **Step 1: Create StatusBar**

Create `app/src/components/StatusBar.tsx`:

```tsx
import { Settings, MODELS, EFFORTS, SORT_ORDERS } from "../types";
import "./StatusBar.css";

interface StatusBarProps {
  settings: Settings;
  filter: string;
  onUpdate: (updates: Partial<Settings>) => void;
}

export default function StatusBar({ settings, filter, onUpdate }: StatusBarProps) {
  const model = MODELS[settings.model_idx]?.display ?? MODELS[0].display;
  const effort = EFFORTS[settings.effort_idx] ?? EFFORTS[0];
  const sort = SORT_ORDERS[settings.sort_idx] ?? SORT_ORDERS[0];

  return (
    <div className="status-bar">
      <div className="status-left">
        {filter && <span className="status-filter">Filter: {filter}</span>}
      </div>
      <div className="status-right">
        <span className="status-item" title="Tab to cycle">
          Model: <strong>{model}</strong>
        </span>
        <span className="status-item" title="F2 to cycle">
          Effort: <strong>{effort}</strong>
        </span>
        <span className="status-item" title="F3 to cycle">
          Sort: <strong>{sort}</strong>
        </span>
        <span
          className={`status-item perms ${settings.skip_perms ? "on" : "off"}`}
          title="F4 to toggle"
        >
          Perms: <strong>{settings.skip_perms ? "SKIP" : "safe"}</strong>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create StatusBar.css**

Create `app/src/components/StatusBar.css`:

```css
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #181825;
  border-top: 1px solid var(--surface);
  font-size: 12px;
  color: var(--text-dim);
  gap: 16px;
}

.status-left {
  display: flex;
  gap: 12px;
}

.status-filter {
  color: var(--accent);
}

.status-right {
  display: flex;
  gap: 16px;
}

.status-item strong {
  color: var(--text);
  font-weight: 600;
}

.status-item.perms.on strong {
  color: var(--red);
}

.status-item.perms.off strong {
  color: var(--green);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/StatusBar.tsx app/src/components/StatusBar.css
git commit -m "feat: add StatusBar component"
```

---

### Task 13: NewTabPage — full launcher interface

**Files:**
- Create: `app/src/components/NewTabPage.tsx`
- Create: `app/src/components/NewTabPage.css`

- [ ] **Step 1: Create NewTabPage**

Create `app/src/components/NewTabPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../hooks/useProjects";
import ProjectList from "./ProjectList";
import StatusBar from "./StatusBar";
import { ProjectInfo, MODELS, EFFORTS, SORT_ORDERS } from "../types";
import "./NewTabPage.css";

interface NewTabPageProps {
  tabId: string;
  onLaunch: (
    tabId: string,
    projectPath: string,
    projectName: string,
    modelIdx: number,
    effortIdx: number,
    skipPerms: boolean,
  ) => void;
  onRequestClose: () => void;
  isActive: boolean;
}

export default function NewTabPage({ tabId, onLaunch, onRequestClose, isActive }: NewTabPageProps) {
  const {
    settings,
    projects,
    loading,
    filter,
    setFilter,
    updateSettings,
    refresh,
    recordUsage,
  } = useProjects();

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [launching, setLaunching] = useState(false);

  // Clamp selection when project list changes
  useEffect(() => {
    if (selectedIdx >= projects.length && projects.length > 0) {
      setSelectedIdx(projects.length - 1);
    }
  }, [projects.length, selectedIdx]);

  const launchProject = useCallback(
    async (project: ProjectInfo) => {
      if (!settings || launching) return;
      setLaunching(true);

      await recordUsage(project.path);

      // Transition tab to terminal — Terminal component will spawn Claude
      onLaunch(
        tabId,
        project.path,
        project.label ?? project.name,
        settings.model_idx,
        settings.effort_idx,
        settings.skip_perms,
      );
    },
    [settings, launching, tabId, onLaunch, recordUsage],
  );

  // Keyboard handler
  useEffect(() => {
    if (!isActive || !settings) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if a global shortcut
      if (e.ctrlKey) return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIdx((prev) => Math.min(projects.length - 1, prev + 1));
          break;
        case "PageUp":
          e.preventDefault();
          setSelectedIdx((prev) => Math.max(0, prev - 10));
          break;
        case "PageDown":
          e.preventDefault();
          setSelectedIdx((prev) => Math.min(projects.length - 1, prev + 10));
          break;
        case "Home":
          e.preventDefault();
          setSelectedIdx(0);
          break;
        case "End":
          e.preventDefault();
          setSelectedIdx(projects.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          if (projects[selectedIdx]) {
            launchProject(projects[selectedIdx]);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (filter) {
            setFilter("");
          } else {
            onRequestClose();
          }
          break;
        case "Tab":
          e.preventDefault();
          updateSettings({
            model_idx: (settings.model_idx + 1) % MODELS.length,
          });
          break;
        case "F2":
          e.preventDefault();
          updateSettings({
            effort_idx: (settings.effort_idx + 1) % EFFORTS.length,
          });
          break;
        case "F3":
          e.preventDefault();
          updateSettings({
            sort_idx: (settings.sort_idx + 1) % SORT_ORDERS.length,
          });
          break;
        case "F4":
          e.preventDefault();
          updateSettings({ skip_perms: !settings.skip_perms });
          break;
        case "F5":
          e.preventDefault();
          // TODO: create project dialog
          break;
        case "F6":
          e.preventDefault();
          if (projects[selectedIdx]) {
            invoke("open_in_explorer", { path: projects[selectedIdx].path });
          }
          break;
        case "F7":
          e.preventDefault();
          // TODO: manage directories dialog
          break;
        case "F8":
          e.preventDefault();
          // TODO: label project dialog
          break;
        case "Backspace":
          e.preventDefault();
          setFilter((prev) => prev.slice(0, -1));
          break;
        default:
          // Printable character → add to filter
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            setFilter((prev) => prev + e.key);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    settings,
    projects,
    selectedIdx,
    filter,
    launching,
    setFilter,
    updateSettings,
    launchProject,
  ]);

  if (!settings) {
    return <div className="new-tab-page">Loading...</div>;
  }

  return (
    <div className="new-tab-page">
      <div className="new-tab-header">
        <h2>Claude Launcher</h2>
        <span className="shortcut-hints">
          Tab:model  F2:effort  F3:sort  F4:perms  F5:new  F6:open  F7:dirs  F8:label
        </span>
      </div>
      <ProjectList
        projects={projects}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
        onActivate={launchProject}
        loading={loading}
      />
      <StatusBar settings={settings} filter={filter} onUpdate={updateSettings} />
    </div>
  );
}
```

- [ ] **Step 2: Create NewTabPage.css**

Create `app/src/components/NewTabPage.css`:

```css
.new-tab-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.new-tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface);
}

.new-tab-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.shortcut-hints {
  font-size: 11px;
  color: var(--text-dim);
  font-family: "Cascadia Code", "Consolas", monospace;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/NewTabPage.tsx app/src/components/NewTabPage.css
git commit -m "feat: add NewTabPage with full launcher controls"
```

---

### Task 14: Final wiring and cleanup

**Files:**
- Modify: `app/src/main.tsx`
- Remove: scaffold boilerplate files

- [ ] **Step 1: Clean up main.tsx**

Replace `app/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Remove scaffold boilerplate**

Delete any scaffold files that aren't needed (e.g., `app/src/assets/`, default `App.css` content already replaced, etc.):

```bash
rm -rf D:/Projects/claude-code-launcher/app/src/assets/
```

- [ ] **Step 3: Verify frontend builds**

```bash
cd D:/Projects/claude-code-launcher/app
npm run build
```

Expected: builds with no errors.

- [ ] **Step 4: Verify full app compiles**

```bash
cd D:/Projects/claude-code-launcher/app
npm run tauri build
```

Expected: produces `.exe` in `app/src-tauri/target/release/`.

- [ ] **Step 5: Commit**

```bash
git add -A app/
git commit -m "feat: wire up all components and clean up scaffold"
```

---

## Chunk 4: Integration Testing & Polish

### Task 15: Manual integration test

- [ ] **Step 1: Run the app in dev mode**

```bash
cd D:/Projects/claude-code-launcher/app
npm run tauri dev
```

- [ ] **Step 2: Test new-tab page**

Verify:
- Project list loads and shows projects
- Arrow keys navigate the list
- Typing filters projects
- Tab cycles model, F2 cycles effort, F3 cycles sort, F4 toggles perms
- F6 opens Explorer on selected project
- Status bar reflects current settings

- [ ] **Step 3: Test launching Claude**

- Select a project, press Enter
- Verify tab transitions to terminal
- Verify Claude starts and you can interact with it
- Verify tab title updates to "project — model"

- [ ] **Step 4: Test multi-tab**

- Press Ctrl+T to open a new tab
- Launch a second Claude instance
- Verify Ctrl+Tab switches between tabs
- Verify the inactive tab shows the blue dot when it gets output
- Verify Ctrl+F4 closes a tab

- [ ] **Step 5: Test exit behavior**

- Let Claude exit or type `/exit` in Claude
- Verify the terminal shows "[Claude exited with code 0. Press any key to close tab]"
- Verify closing the app with active sessions shows confirmation

- [ ] **Step 6: Fix any issues found and commit**

```bash
git add -A app/
git commit -m "fix: integration test fixes"
```

---

### Task 16: App close confirmation

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add close confirmation**

In `App.tsx`, add a window close listener:

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

useEffect(() => {
  const appWindow = getCurrentWindow();
  const unlisten = appWindow.onCloseRequested(async (event) => {
    const terminalCount = tabs.filter(
      (t) => t.type === "terminal" && t.exitCode == null,
    ).length;

    if (terminalCount > 0) {
      const confirmed = await window.confirm(
        `${terminalCount} active Claude session(s). Close all?`,
      );
      if (!confirmed) {
        event.preventDefault();
      }
    }
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}, [tabs]);
```

- [ ] **Step 2: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat: confirm before closing app with active sessions"
```

---

### Task 17: Final build and release verification

- [ ] **Step 1: Build release binary**

```bash
cd D:/Projects/claude-code-launcher/app
npm run tauri build
```

- [ ] **Step 2: Test the release binary**

Run the generated `.exe` from `app/src-tauri/target/release/bundle/` and verify all features work outside dev mode.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: finalize tabbed Claude launcher v1.0"
```
