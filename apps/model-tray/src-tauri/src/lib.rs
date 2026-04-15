mod gpu;
mod models;
mod providers;
mod scanner;
mod sidecar;

use crate::gpu::collect_gpu;
use crate::models::{
    now_ms, ActionResult, AppSnapshot, CopyEndpointRequest, LoadRequest, ProviderProfile,
    StartProviderRequest, UnloadRequest,
};
use crate::providers::{
    build_pressure, collect_providers, default_profiles, load_model as provider_load_model,
    start_provider as provider_start_provider, unload_model as provider_unload_model,
};
use crate::scanner::scan_system;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

struct AppState {
    profiles: Vec<ProviderProfile>,
}

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> AppSnapshot {
    collect_snapshot(&state.profiles)
}

#[tauri::command]
fn refresh_state(state: State<'_, AppState>) -> AppSnapshot {
    collect_snapshot(&state.profiles)
}

#[tauri::command]
fn load_model(state: State<'_, AppState>, request: LoadRequest) -> Result<ActionResult, String> {
    provider_load_model(&state.profiles, request)
}

#[tauri::command]
fn unload_model(
    state: State<'_, AppState>,
    request: UnloadRequest,
) -> Result<ActionResult, String> {
    provider_unload_model(&state.profiles, request)
}

#[tauri::command]
fn start_provider(
    state: State<'_, AppState>,
    request: StartProviderRequest,
) -> Result<ActionResult, String> {
    provider_start_provider(&state.profiles, request)
}

#[tauri::command]
fn copy_endpoint(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CopyEndpointRequest,
) -> Result<ActionResult, String> {
    let endpoint = request.endpoint.trim();
    validate_known_endpoint(&state.profiles, endpoint)?;
    app.clipboard()
        .write_text(endpoint.to_owned())
        .map_err(|err| format!("Clipboard write failed: {err}"))?;

    Ok(ActionResult {
        ok: true,
        provider_id: "clipboard".to_owned(),
        model: None,
        endpoint_url: Some(endpoint.to_owned()),
        message: "Endpoint copied to clipboard.".to_owned(),
    })
}

fn collect_snapshot(profiles: &[ProviderProfile]) -> AppSnapshot {
    let gpu = collect_gpu();
    let pressure = build_pressure(&gpu);
    let system_scan = scan_system(profiles);
    let providers = collect_providers(profiles, &system_scan.providers);
    let warnings = gpu.warning.clone().into_iter().collect();

    AppSnapshot {
        timestamp_ms: now_ms(),
        gpu: gpu.gpu,
        gpu_warning: gpu.warning,
        providers,
        detected_tools: system_scan.detected_tools,
        pressure,
        warnings,
    }
}

fn validate_known_endpoint(profiles: &[ProviderProfile], endpoint: &str) -> Result<(), String> {
    if endpoint.len() > 512
        || !(endpoint.starts_with("http://") || endpoint.starts_with("https://"))
    {
        return Err("Endpoint must be an http(s) URL under a configured provider.".to_owned());
    }

    if profiles.iter().any(|profile| {
        endpoint.starts_with(&profile.base_url) || endpoint.starts_with(&profile.endpoint_url)
    }) {
        return Ok(());
    }

    Err("Refusing to copy an endpoint outside the configured provider allowlist.".to_owned())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open Model Tray", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "Refresh State", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &refresh_i, &quit_i])?;

    TrayIconBuilder::new()
        .tooltip("Model Tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "refresh" => {
                let _ = app.emit("model-tray://refresh", ());
                show_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            profiles: default_profiles(),
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            refresh_state,
            load_model,
            unload_model,
            start_provider,
            copy_endpoint
        ])
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Model Tray");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProviderKind;

    #[test]
    fn endpoint_copy_is_provider_allowlisted() {
        let profiles = vec![ProviderProfile {
            id: "test".to_owned(),
            name: "Test".to_owned(),
            kind: ProviderKind::OpenAiCompatible,
            capabilities: vec!["llm".to_owned()],
            base_url: "http://127.0.0.1:9999".to_owned(),
            endpoint_url: "http://127.0.0.1:9999/v1".to_owned(),
            user_service: None,
        }];

        assert!(validate_known_endpoint(&profiles, "http://127.0.0.1:9999/v1/models").is_ok());
        assert!(validate_known_endpoint(&profiles, "https://example.com/v1/models").is_err());
    }
}
