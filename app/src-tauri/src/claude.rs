use std::path::{Path, PathBuf};

pub const MODELS: &[(&str, &str)] = &[
    ("sonnet", "claude-sonnet-4-6"),
    ("opus", "claude-opus-4-6"),
    ("haiku", "claude-haiku-4-5"),
    ("sonnet [1M]", "claude-sonnet-4-6[1m]"),
    ("opus [1M]", "claude-opus-4-6[1m]"),
];

pub const EFFORTS: &[&str] = &["high", "medium", "low"];

pub fn resolve_claude_exe() -> Result<PathBuf, String> {
    if let Ok(path) = which::which("claude") {
        return Ok(path);
    }

    if let Some(home) = dirs::home_dir() {
        let fallback = home.join(".local").join("bin").join("claude.exe");
        if fallback.exists() {
            return Ok(fallback);
        }
    }

    Err("Claude executable not found. Install with: npm install -g @anthropic-ai/claude-code".to_string())
}

pub fn build_command(
    claude_exe: &Path,
    model_idx: usize,
    effort_idx: usize,
    skip_perms: bool,
) -> (String, Vec<String>) {
    let model_id = MODELS
        .get(model_idx)
        .map(|(_, id)| *id)
        .unwrap_or(MODELS[0].1);

    let effort = EFFORTS.get(effort_idx).copied().unwrap_or(EFFORTS[0]);

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
        // Quote the exe path for cmd.exe /c to handle spaces
        let mut args = vec!["/c".to_string(), format!("\"{}\"", exe_str)];
        args.extend(claude_args);
        ("cmd.exe".to_string(), args)
    } else {
        (exe_str, claude_args)
    }
}

pub fn claude_env() -> Vec<(String, String)> {
    vec![
        ("CLAUDE_CODE_MAX_OUTPUT_TOKENS".to_string(), "64000".to_string()),
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
    ]
}
