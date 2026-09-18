use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn log(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:\\GPT-Chat-codex-handoff\\tauri.log")
    {
        let _ = writeln!(f, "[{}] {}", chrono_lite(), msg);
    }
    println!("{}", msg);
}

fn chrono_lite() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
fn check_backend_status() -> String {
    "HEALTHY".to_string()
}

fn find_handoff_js() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("bin\\handoff.js"),
        PathBuf::from("..\\bin\\handoff.js"),
        PathBuf::from("handoff-core\\bin\\handoff.js"),
        PathBuf::from("C:\\code\\Chat-Codex\\handoff-core\\bin\\handoff.js"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p1 = parent.join("bin\\handoff.js");
            if p1.exists() { return Some(p1); }
            let p2 = parent.join("..\\bin\\handoff.js");
            if p2.exists() { return Some(p2); }
            let p3 = parent.join("..\\..\\..\\bin\\handoff.js");
            if p3.exists() { return Some(p3); }
        }
    }
    None
}

fn ensure_backend_running() {
    log("Checking backend port 8765...");
    let mut is_up = std::net::TcpStream::connect("127.0.0.1:8765").is_ok();
    if !is_up {
        log("Backend not active on 127.0.0.1:8765, attempting to spawn node...");
        let script = find_handoff_js().unwrap_or_else(|| PathBuf::from("C:\\code\\Chat-Codex\\handoff-core\\bin\\handoff.js"));
        log(&format!("Found handoff script: {:?}", script));
        let work_dir = script.parent().and_then(|p| p.parent()).unwrap_or_else(|| Path::new("C:\\code\\Chat-Codex\\handoff-core"));

        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("cmd")
                .current_dir(work_dir)
                .args(["/c", "start", "/min", "cmd", "/c", "node", "bin\\handoff.js", "gui", "--port", "8765", "--no-open"])
                .spawn();
        }

        for _ in 0..25 {
            thread::sleep(Duration::from_millis(200));
            if std::net::TcpStream::connect("127.0.0.1:8765").is_ok() {
                is_up = true;
                break;
            }
        }
    }
    if is_up {
        log("Backend successfully connected on 127.0.0.1:8765.");
    } else {
        log("Warning: Could not connect to backend port 8765 within timeout.");
    }
}

fn main() {
    log("=== Chat-Codex Studio Starting ===");
    ensure_backend_running();

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_backend_status])
        .setup(|app| {
            log(&format!("Setup hook entered. Config windows count: {}", app.config().app.windows.len()));
            
            // Check if 'main' window already created by tauri.conf.json
            let main_win = app.get_webview_window("main");
            if let Some(win) = main_win {
                log("Main window exists from config, showing...");
                let _ = win.show();
                let _ = win.set_focus();
            } else {
                log("Main window not created by config, manually creating WebviewWindow...");
                let target_url: tauri::Url = "http://127.0.0.1:8765".parse().expect("valid url");
                let builder = WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External(target_url),
                )
                .title("Chat-Codex Studio v2.5.0")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .resizable(true)
                .visible(true);

                match builder.build() {
                    Ok(win) => {
                        log("Main window successfully built manually!");
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    Err(e) => {
                        log(&format!("Failed to build main window: {:?}", e));
                    }
                }
            }
            Ok(())
        });

    log("Calling app.run()...");
    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
    log("app.run() terminated.");
}

