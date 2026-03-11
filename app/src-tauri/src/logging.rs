use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::projects::data_dir;

static LOG_FILE: Mutex<Option<File>> = Mutex::new(None);

pub fn log_path() -> PathBuf {
    data_dir().join("claude-launcher.log")
}

pub fn init() {
    let path = log_path();

    // Truncate old log on startup (keep only current session)
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path);

    match file {
        Ok(mut f) => {
            let _ = writeln!(f, "[{}] === Claude Launcher started ===", timestamp());
            let _ = writeln!(f, "[{}] Log file: {}", timestamp(), path.display());
            *LOG_FILE.lock().unwrap_or_else(|e| e.into_inner()) = Some(f);
        }
        Err(e) => {
            eprintln!("Failed to open log file {}: {e}", path.display());
        }
    }
}

pub fn log(level: &str, msg: &str) {
    let line = format!("[{}] [{level}] {msg}", timestamp());

    // Always print to stderr for dev console
    eprintln!("{line}");

    // Also write to file
    {
        let mut guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut f) = *guard {
            let _ = writeln!(f, "{line}");
            let _ = f.flush();
        }
    }
}

fn timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();

    let total_secs = now.as_secs();
    let millis = now.subsec_millis();

    // Date from epoch
    let days = total_secs / 86400;
    let (year, month, day) = days_to_date(days);

    // Time of day (UTC)
    let secs_in_day = total_secs % 86400;
    let hours = secs_in_day / 3600;
    let minutes = (secs_in_day % 3600) / 60;
    let seconds = secs_in_day % 60;

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Civil date from days since 1970-01-01 (Algorithm from Howard Hinnant)
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        $crate::logging::log("INFO", &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => {
        $crate::logging::log("ERROR", &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_debug {
    ($($arg:tt)*) => {
        $crate::logging::log("DEBUG", &format!($($arg)*))
    };
}
