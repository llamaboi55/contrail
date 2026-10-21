//! Contrail: a focus timer where every session is a flight. The whole app lives in
//! the web view; the native side adds the small always-on-top window, notifications
//! and a single running copy.
use std::sync::Mutex;
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Size of the small window, in logical pixels.
const MINI: (f64, f64) = (360.0, 220.0);
const MARGIN: f64 = 24.0;

/// Where the window was before it went small, so it can go back.
#[derive(Default)]
struct Restore(Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>>);

/// Top-left corner for the small window: the bottom-right of the monitor's work area.
fn mini_origin(area_pos: (i32, i32), area_size: (u32, u32), scale: f64) -> (i32, i32) {
    let w = ((MINI.0 + MARGIN) * scale).round() as i32;
    let h = ((MINI.1 + MARGIN) * scale).round() as i32;
    let x = area_pos.0 + (area_size.0 as i32 - w).max(0);
    let y = area_pos.1 + (area_size.1 as i32 - h).max(0);
    (x, y)
}

fn go_mini(win: &WebviewWindow, restore: &Restore) -> tauri::Result<()> {
    let mut saved = restore.0.lock().unwrap();
    if saved.is_none() {
        *saved = Some((win.outer_position()?, win.outer_size()?));
    }
    if win.is_maximized()? {
        win.unmaximize()?;
    }
    if win.is_fullscreen()? {
        win.set_fullscreen(false)?;
    }
    win.set_always_on_top(true)?;
    win.set_size(tauri::LogicalSize::new(MINI.0, MINI.1))?;
    if let Some(m) = win.current_monitor()? {
        let area = m.work_area();
        let (x, y) = mini_origin((area.position.x, area.position.y), (area.size.width, area.size.height), m.scale_factor());
        win.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

fn go_big(win: &WebviewWindow, restore: &Restore) -> tauri::Result<()> {
    win.set_always_on_top(false)?;
    if let Some((pos, size)) = restore.0.lock().unwrap().take() {
        win.set_size(size)?;
        win.set_position(pos)?;
    }
    Ok(())
}

/// Switches between the full window and a small one that stays on top of other apps.
#[tauri::command]
fn set_mini(window: WebviewWindow, restore: tauri::State<Restore>, on: bool) -> Result<(), String> {
    let r = if on { go_mini(&window, &restore) } else { go_big(&window, &restore) };
    r.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(Restore::default())
        .invoke_handler(tauri::generate_handler![set_mini])
        .run(tauri::generate_context!())
        .expect("error while running Contrail");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mini_sits_in_the_bottom_right_corner() {
        assert_eq!(mini_origin((0, 0), (1920, 1040), 1.0), (1920 - 384, 1040 - 244));
        assert_eq!(mini_origin((1920, 0), (2560, 1400), 2.0), (1920 + 2560 - 768, 1400 - 488));
    }

    #[test]
    fn mini_never_leaves_a_tiny_screen() {
        assert_eq!(mini_origin((-1280, 100), (300, 200), 1.0), (-1280, 100));
    }
}
