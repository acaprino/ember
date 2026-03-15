use std::path::Path;

/// Directories to skip when scanning for file path completions.
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", ".next", "dist", "build",
    "__pycache__", ".venv", ".tox", ".mypy_cache",
];

/// Check if user input looks like it contains a file path fragment.
/// Returns the path prefix to complete if found, or None.
fn extract_path_prefix(input: &str) -> Option<&str> {
    let token = input.rsplit_once(char::is_whitespace)
        .map(|(_, t)| t)
        .unwrap_or(input);

    if token.contains('/') || token.contains('\\') {
        return Some(token);
    }

    const PATH_PREFIXES: &[&str] = &[
        "src", "app", "lib", "test", "tests", "docs", "config",
        "scripts", "pkg", "cmd", "internal", "public", "assets",
    ];
    if PATH_PREFIXES.iter().any(|p| token.starts_with(p)) {
        return Some(token);
    }

    None
}

/// Walk a directory recursively up to a depth limit, collecting files
/// whose relative path starts with the given prefix.
fn collect_matches(
    base: &Path,
    current: &Path,
    prefix_lower: &str,
    depth: usize,
    max_depth: usize,
    results: &mut Vec<String>,
    max_results: usize,
) {
    if depth > max_depth || results.len() >= max_results {
        return;
    }

    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if results.len() >= max_results {
            return;
        }

        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }

        let rel_path = match entry.path().strip_prefix(base) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let rel_lower = rel_path.to_lowercase();

        if rel_lower.starts_with(prefix_lower) {
            results.push(rel_path.clone());
        }

        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            if prefix_lower.starts_with(&rel_lower) || rel_lower.starts_with(prefix_lower) {
                collect_matches(base, &entry.path(), prefix_lower, depth + 1, max_depth, results, max_results);
            }
        }
    }
}

#[tauri::command]
pub async fn autocomplete_files(cwd: String, input: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let prefix = match extract_path_prefix(&input) {
            Some(p) => p,
            None => return Ok(vec![]),
        };

        let base = Path::new(&cwd);
        if !base.is_dir() {
            return Ok(vec![]);
        }

        // Reject UNC paths and paths outside normal filesystem
        if cwd.starts_with("\\\\") {
            return Ok(vec![]);
        }

        // Canonicalize to prevent traversal via symlinks
        let canonical = match base.canonicalize() {
            Ok(c) => c,
            Err(_) => return Ok(vec![]),
        };

        let prefix_lower = prefix.to_lowercase().replace('\\', "/");
        let mut results = Vec::new();
        collect_matches(&canonical, &canonical, &prefix_lower, 0, 5, &mut results, 5);

        // Sort: exact prefix matches first, then alphabetical
        results.sort_by(|a, b| {
            let a_exact = a.to_lowercase().starts_with(&prefix_lower);
            let b_exact = b.to_lowercase().starts_with(&prefix_lower);
            b_exact.cmp(&a_exact).then(a.cmp(b))
        });

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}
