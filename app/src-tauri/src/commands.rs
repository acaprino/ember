use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

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
    log_info!("spawn_claude: project={project_path}, model={model_idx}, effort={effort_idx}, skip_perms={skip_perms}, cols={cols}, rows={rows}");

    if projects::is_unc(&project_path) {
        log_error!("spawn_claude: UNC paths not supported: {project_path}");
        return Err("UNC paths are not supported".to_string());
    }
    if !std::path::Path::new(&project_path).is_dir() {
        log_error!("spawn_claude: path is not a directory: {project_path}");
        return Err("Project path does not exist or is not a directory".to_string());
    }

    if cols <= 0 || rows <= 0 || cols > 500 || rows > 200 {
        log_error!("spawn_claude: invalid dimensions {cols}x{rows}");
        return Err("Invalid terminal dimensions".to_string());
    }

    let claude_exe = claude::resolve_claude_exe().map_err(|e| {
        log_error!("spawn_claude: failed to resolve claude exe: {e}");
        e
    })?;

    let (program, args) = claude::build_command(&claude_exe, model_idx, effort_idx, skip_perms);

    let mut cmd_parts = vec![program];
    cmd_parts.extend(args);
    let command_line = cmd_parts
        .iter()
        .map(|p| if p.contains(' ') && !p.starts_with('"') { format!("\"{}\"", p) } else { p.clone() })
        .collect::<Vec<_>>()
        .join(" ");
    log_info!("spawn_claude: command_line={command_line}");

    let env = claude::claude_env();

    let result = registry.spawn(&command_line, &project_path, &env, cols, rows, on_event);
    match &result {
        Ok(id) => log_info!("spawn_claude: session created id={id}"),
        Err(e) => log_error!("spawn_claude: failed: {e}"),
    }
    result
}

#[tauri::command]
pub async fn write_pty(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    registry.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub async fn resize_pty(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    cols: i16,
    rows: i16,
) -> Result<(), String> {
    if cols <= 0 || rows <= 0 || cols > 500 || rows > 200 {
        return Err("Invalid terminal dimensions".to_string());
    }
    registry.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn kill_session(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
) -> Result<(), String> {
    log_info!("kill_session: {session_id}");
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
    log_info!("scan_projects: dirs={project_dirs:?}");
    let projs = tokio::task::spawn_blocking(move || projects::scan_projects(&project_dirs, &labels))
        .await
        .map_err(|e| format!("Task failed: {e}"))?;
    log_info!("scan_projects: found {} projects", projs.len());
    Ok(projs)
}

#[tauri::command]
pub async fn load_settings() -> Result<Settings, String> {
    log_info!("load_settings");
    tokio::task::spawn_blocking(|| Ok(projects::load_settings()))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn save_settings(settings: Settings) -> Result<(), String> {
    log_info!("save_settings: dirs={:?}", settings.project_dirs);
    tokio::task::spawn_blocking(move || {
        projects::save_settings(&settings).map_err(|e| format!("Failed to save settings: {e}"))
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn load_usage() -> Result<UsageData, String> {
    tokio::task::spawn_blocking(|| Ok(projects::load_usage()))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn record_usage(project_path: String) -> Result<(), String> {
    log_info!("record_usage: {project_path}");
    tokio::task::spawn_blocking(move || {
        projects::record_usage(&project_path).map_err(|e| format!("Failed to record usage: {e}"))
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    log_info!("open_in_explorer: {path}");
    if projects::is_unc(&path) {
        return Err("UNC paths are not supported".to_string());
    }
    if !std::path::Path::new(&path).is_dir() {
        log_error!("open_in_explorer: not a directory: {path}");
        return Err("Path is not a valid directory".to_string());
    }
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
    log_info!("create_project: parent={parent}, name={name}, git_init={git_init}");
    let result = tokio::task::spawn_blocking(move || projects::create_project(&parent, &name, git_init))
        .await
        .map_err(|e| format!("Task failed: {e}"))?;
    match &result {
        Ok(path) => log_info!("create_project: created at {path}"),
        Err(e) => log_error!("create_project: failed: {e}"),
    }
    result
}

#[tauri::command]
pub async fn save_session(session: serde_json::Value) -> Result<(), String> {
    log_info!("save_session");
    tokio::task::spawn_blocking(move || {
        projects::save_session(&session).map_err(|e| format!("Failed to save session: {e}"))
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn load_session() -> Result<serde_json::Value, String> {
    log_info!("load_session");
    tokio::task::spawn_blocking(|| Ok(projects::load_session().unwrap_or(serde_json::Value::Null)))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}
