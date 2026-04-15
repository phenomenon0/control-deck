use crate::gpu::{collect_gpu, GpuCollection};
use crate::models::{
    configured_vram_reserve_mb, ActionResult, EndpointInfo, LoadRequest, LoadedModel, ModelInfo,
    PressureSnapshot, PressureState, ProviderKind, ProviderProfile, ProviderScan, ProviderSnapshot,
    ProviderStatus, StartProviderRequest, UnloadRequest,
};
use crate::sidecar::ensure_piper_sidecar;
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

const MIB: u64 = 1024 * 1024;

pub fn default_profiles() -> Vec<ProviderProfile> {
    let mut profiles = vec![
        ProviderProfile {
            id: "ollama".to_owned(),
            name: "Ollama".to_owned(),
            kind: ProviderKind::Ollama,
            capabilities: vec!["llm".to_owned()],
            base_url: root_url_from_env("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            endpoint_url: endpoint_url_from_env("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            user_service: env_service("MODEL_TRAY_OLLAMA_USER_SERVICE"),
        },
        ProviderProfile {
            id: "vllm".to_owned(),
            name: "vLLM".to_owned(),
            kind: ProviderKind::Vllm,
            capabilities: vec!["llm".to_owned()],
            base_url: root_url_from_env("VLLM_BASE_URL", "http://127.0.0.1:8000"),
            endpoint_url: endpoint_url_from_env("VLLM_BASE_URL", "http://127.0.0.1:8000"),
            user_service: env_service("MODEL_TRAY_VLLM_USER_SERVICE"),
        },
        ProviderProfile {
            id: "llama-cpp".to_owned(),
            name: "llama.cpp Server".to_owned(),
            kind: ProviderKind::LlamaCpp,
            capabilities: vec!["llm".to_owned()],
            base_url: root_url_from_env("LLAMA_CPP_BASE_URL", "http://127.0.0.1:8080"),
            endpoint_url: endpoint_url_from_env("LLAMA_CPP_BASE_URL", "http://127.0.0.1:8080"),
            user_service: env_service("MODEL_TRAY_LLAMA_CPP_USER_SERVICE"),
        },
        ProviderProfile {
            id: "lmstudio".to_owned(),
            name: "LM Studio".to_owned(),
            kind: ProviderKind::LmStudio,
            capabilities: vec!["llm".to_owned()],
            base_url: root_url_from_env("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234"),
            endpoint_url: endpoint_url_from_env("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234"),
            user_service: None,
        },
        ProviderProfile {
            id: "comfyui".to_owned(),
            name: "ComfyUI".to_owned(),
            kind: ProviderKind::ComfyUi,
            capabilities: vec!["image".to_owned()],
            base_url: root_url_from_env("COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            endpoint_url: root_url_from_env("COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            user_service: env_service("MODEL_TRAY_COMFYUI_USER_SERVICE"),
        },
        ProviderProfile {
            id: "whisper".to_owned(),
            name: "Whisper STT".to_owned(),
            kind: ProviderKind::Whisper,
            capabilities: vec!["stt".to_owned()],
            base_url: root_url_from_env("WHISPER_BASE_URL", "http://127.0.0.1:9000"),
            endpoint_url: endpoint_url_from_env("WHISPER_BASE_URL", "http://127.0.0.1:9000"),
            user_service: env_service("MODEL_TRAY_WHISPER_USER_SERVICE"),
        },
        ProviderProfile {
            id: "piper-tts".to_owned(),
            name: "Piper TTS".to_owned(),
            kind: ProviderKind::PiperTts,
            capabilities: vec!["tts".to_owned()],
            base_url: root_url_from_env("PIPER_TTS_BASE_URL", "http://127.0.0.1:9242"),
            endpoint_url: format!(
                "{}/tts/piper",
                root_url_from_env("PIPER_TTS_BASE_URL", "http://127.0.0.1:9242")
            ),
            user_service: env_service("MODEL_TRAY_PIPER_USER_SERVICE"),
        },
        ProviderProfile {
            id: "huggingface".to_owned(),
            name: "Hugging Face Cache".to_owned(),
            kind: ProviderKind::HuggingFace,
            capabilities: vec!["cache".to_owned()],
            base_url: "local://huggingface".to_owned(),
            endpoint_url: "local://huggingface".to_owned(),
            user_service: None,
        },
    ];

    if let Ok(custom_url) = std::env::var("MODEL_TRAY_CUSTOM_BASE_URL") {
        let root = normalize_root_url(&custom_url);
        profiles.push(ProviderProfile {
            id: "custom".to_owned(),
            name: "Custom OpenAI-compatible".to_owned(),
            kind: ProviderKind::OpenAiCompatible,
            capabilities: vec!["llm".to_owned()],
            endpoint_url: format!("{root}/v1"),
            base_url: root,
            user_service: env_service("MODEL_TRAY_CUSTOM_USER_SERVICE"),
        });
    }

    profiles
}

pub fn collect_providers(
    profiles: &[ProviderProfile],
    scans: &HashMap<String, ProviderScan>,
) -> Vec<ProviderSnapshot> {
    let client = http_client();
    let handles = profiles
        .iter()
        .cloned()
        .map(|profile| {
            let client = client.clone();
            let scan = scans
                .get(&profile.id)
                .cloned()
                .unwrap_or_else(ProviderScan::unknown);
            thread::spawn(move || inspect_provider(&client, profile, scan))
        })
        .collect::<Vec<_>>();

    handles
        .into_iter()
        .filter_map(|handle| handle.join().ok())
        .collect()
}

pub fn inspect_provider(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
) -> ProviderSnapshot {
    match profile.kind {
        ProviderKind::Ollama => inspect_ollama(client, profile, scan),
        ProviderKind::Vllm => inspect_vllm(client, profile, scan),
        ProviderKind::LlamaCpp | ProviderKind::LmStudio | ProviderKind::OpenAiCompatible => {
            inspect_openai_compatible(client, profile, scan, None)
        }
        ProviderKind::ComfyUi => inspect_comfyui(client, profile, scan),
        ProviderKind::Whisper => inspect_whisper(client, profile, scan),
        ProviderKind::PiperTts => inspect_piper(client, profile, scan),
        ProviderKind::HuggingFace => inspect_huggingface_cache(profile, scan),
    }
}

pub fn build_pressure(gpu: &GpuCollection) -> PressureSnapshot {
    let reserve_mb = configured_vram_reserve_mb();
    match &gpu.gpu {
        Some(gpu) if gpu.memory_free_mb < reserve_mb => PressureSnapshot {
            reserve_mb,
            free_mb: Some(gpu.memory_free_mb),
            state: PressureState::Critical,
            message: format!(
                "Only {} MB VRAM free; reserve is {} MB.",
                gpu.memory_free_mb, reserve_mb
            ),
        },
        Some(gpu) if gpu.memory_percent >= 85 => PressureSnapshot {
            reserve_mb,
            free_mb: Some(gpu.memory_free_mb),
            state: PressureState::Warning,
            message: format!("GPU memory is {}% allocated.", gpu.memory_percent),
        },
        Some(gpu) => PressureSnapshot {
            reserve_mb,
            free_mb: Some(gpu.memory_free_mb),
            state: PressureState::Ok,
            message: format!("{} MB VRAM free.", gpu.memory_free_mb),
        },
        None => PressureSnapshot {
            reserve_mb,
            free_mb: None,
            state: PressureState::Unknown,
            message: gpu
                .warning
                .clone()
                .unwrap_or_else(|| "GPU state is unavailable.".to_owned()),
        },
    }
}

pub fn load_model(
    profiles: &[ProviderProfile],
    request: LoadRequest,
) -> Result<ActionResult, String> {
    validate_model_name(&request.model)?;
    let profile = find_profile(profiles, &request.provider_id)?;
    let client = http_client();
    let snapshot = inspect_provider(&client, profile.clone(), ProviderScan::unknown());
    let model = snapshot
        .installed_models
        .iter()
        .find(|candidate| candidate.name == request.model);
    let estimate_mb = model.and_then(|model| estimate_vram_mb(model.size_bytes));
    let model_source_path = model.and_then(|model| model.source_path.clone());
    let provider_status = snapshot.status.clone();

    if requires_vram_guard(&profile, model) {
        enforce_vram_guard(&request, estimate_mb, &collect_gpu())?;
    }

    match profile.kind {
        ProviderKind::Ollama => {
            if provider_status != ProviderStatus::Online {
                start_ollama_serve()?;
                wait_for_url(&client, &format!("{}/api/tags", profile.base_url), 20)?;
            }
            load_ollama(&client, &profile, &request)
        }
        ProviderKind::LlamaCpp => {
            if let Some(service) = &profile.user_service {
                run_user_service_action("start", service)?;
                return Ok(ActionResult {
                    ok: true,
                    provider_id: profile.id.clone(),
                    model: Some(request.model.clone()),
                    endpoint_url: Some(profile.endpoint_url.clone()),
                    message: format!("Started user service {service}."),
                });
            }
            let source_path = model_source_path.ok_or_else(|| {
                "No GGUF file path is attached to this model row; rescan offline models first."
                    .to_owned()
            })?;
            start_llama_cpp_server(&profile, &request.model, &source_path)
        }
        ProviderKind::Vllm => {
            if let Some(service) = &profile.user_service {
                run_user_service_action("start", service)?;
                return Ok(ActionResult {
                    ok: true,
                    provider_id: profile.id.clone(),
                    model: Some(request.model.clone()),
                    endpoint_url: Some(profile.endpoint_url.clone()),
                    message: format!("Started user service {service}."),
                });
            }
            start_vllm_server(&profile, &request.model)
        }
        ProviderKind::ComfyUi => start_comfyui_server(&profile, Some(&request.model)),
        ProviderKind::Whisper => start_whisper_server(&profile, &request.model, model),
        ProviderKind::PiperTts => start_piper_tts(&profile, &request.model),
        ProviderKind::HuggingFace => {
            start_huggingface_cached_model(&profile, &request.model, model)
        }
        ProviderKind::LmStudio | ProviderKind::OpenAiCompatible => {
            start_profile_service(&profile, &request.model)
        }
    }
}

pub fn unload_model(
    profiles: &[ProviderProfile],
    request: UnloadRequest,
) -> Result<ActionResult, String> {
    validate_model_name(&request.model)?;
    let profile = find_profile(profiles, &request.provider_id)?;
    let client = http_client();

    match profile.kind {
        ProviderKind::Ollama => unload_ollama(&client, &profile, &request.model),
        ProviderKind::Vllm
        | ProviderKind::LlamaCpp
        | ProviderKind::LmStudio
        | ProviderKind::OpenAiCompatible
        | ProviderKind::ComfyUi
        | ProviderKind::Whisper => stop_profile_service(&profile, &request.model),
        ProviderKind::PiperTts => Ok(ActionResult {
            ok: true,
            provider_id: profile.id.clone(),
            model: Some(request.model.clone()),
            endpoint_url: Some(profile.endpoint_url.clone()),
            message: "Piper sidecar is shared; selected voice will be used for the next request."
                .to_owned(),
        }),
        ProviderKind::HuggingFace => Err(
            "Hugging Face cache entries unload through their serving adapter, not the cache catalog."
                .to_owned(),
        ),
    }
}

pub fn start_provider(
    profiles: &[ProviderProfile],
    request: StartProviderRequest,
) -> Result<ActionResult, String> {
    let profile = find_profile(profiles, &request.provider_id)?;

    if let Some(service) = &profile.user_service {
        run_user_service_action("start", service)?;
        return Ok(ActionResult {
            ok: true,
            provider_id: profile.id.clone(),
            model: None,
            endpoint_url: Some(profile.endpoint_url.clone()),
            message: format!("Started user service {service}."),
        });
    }

    match profile.kind {
        ProviderKind::Ollama => {
            start_ollama_serve()?;

            Ok(ActionResult {
                ok: true,
                provider_id: profile.id.clone(),
                model: None,
                endpoint_url: Some(profile.endpoint_url.clone()),
                message: "Started `ollama serve` as a user process.".to_owned(),
            })
        }
        ProviderKind::ComfyUi => start_comfyui_server(&profile, None),
        ProviderKind::PiperTts => {
            ensure_piper_sidecar(&profile.base_url, None)?;
            Ok(ActionResult {
                ok: true,
                provider_id: profile.id.clone(),
                model: None,
                endpoint_url: Some(profile.endpoint_url.clone()),
                message: "Started Piper localhost TTS sidecar.".to_owned(),
            })
        }
        ProviderKind::Whisper => {
            Err("Pick a faster-whisper model row to start the Whisper server.".to_owned())
        }
        ProviderKind::HuggingFace => {
            Err("Pick a Hugging Face cache row with a serve target.".to_owned())
        }
        _ => Err(format!(
            "{} needs an owned user service profile before Model Tray can start it safely.",
            profile.name
        )),
    }
}

fn inspect_ollama(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
) -> ProviderSnapshot {
    let tags_url = format!("{}/api/tags", profile.base_url);
    let ps_url = format!("{}/api/ps", profile.base_url);

    let tags = client
        .get(tags_url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<OllamaTagsResponse>());

    let Ok(tags) = tags else {
        return provider_offline(profile, scan, "Ollama API is not reachable.");
    };

    let loaded_models = client
        .get(ps_url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<OllamaPsResponse>())
        .map(|response| response.models.into_iter().map(LoadedModel::from).collect())
        .unwrap_or_default();

    let mut installed_models = tags
        .models
        .into_iter()
        .map(ModelInfo::from)
        .collect::<Vec<_>>();
    installed_models.sort_by(|a, b| a.name.cmp(&b.name));

    provider_online(profile, scan, installed_models, loaded_models, None)
}

fn inspect_vllm(client: &Client, profile: ProviderProfile, scan: ProviderScan) -> ProviderSnapshot {
    let metrics_online = client
        .get(format!("{}/metrics", profile.base_url))
        .send()
        .and_then(|response| response.error_for_status())
        .is_ok();

    let mut snapshot = inspect_openai_compatible(
        client,
        profile,
        scan,
        metrics_online.then(|| "Prometheus metrics online.".to_owned()),
    );
    if snapshot.status == ProviderStatus::Online && !metrics_online {
        snapshot.status = ProviderStatus::Degraded;
        snapshot.message =
            Some("OpenAI endpoint online; Prometheus metrics unavailable.".to_owned());
    }
    snapshot
}

fn inspect_comfyui(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
) -> ProviderSnapshot {
    let online = client
        .get(format!("{}/system_stats", profile.base_url))
        .send()
        .and_then(|response| response.error_for_status())
        .is_ok()
        || client
            .get(format!("{}/queue", profile.base_url))
            .send()
            .and_then(|response| response.error_for_status())
            .is_ok();

    if online {
        return provider_online(
            profile.clone(),
            scan,
            offline_models_for_profile(&profile),
            Vec::new(),
            Some("ComfyUI API is reachable.".to_owned()),
        );
    }

    provider_offline(profile, scan, "ComfyUI API is not reachable.")
}

fn inspect_whisper(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
) -> ProviderSnapshot {
    let models = client
        .get(format!("{}/models", profile.endpoint_url))
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<OpenAiModelsResponse>());

    if let Ok(models) = models {
        let installed_models = models
            .data
            .into_iter()
            .map(|model| ModelInfo {
                name: model.id,
                size_bytes: None,
                family: Some("faster-whisper".to_owned()),
                quantization: None,
                modified_at: None,
                source_path: None,
                capabilities: vec!["stt".to_owned()],
                model_format: Some("openai-audio-api".to_owned()),
                serve_targets: vec!["whisper-server".to_owned()],
            })
            .collect::<Vec<_>>();
        let loaded_models = installed_models
            .iter()
            .map(|model| LoadedModel {
                name: model.name.clone(),
                size_bytes: None,
                vram_bytes: None,
                expires_at: None,
                endpoint_url: Some(format!("{}/audio/transcriptions", profile.endpoint_url)),
            })
            .collect::<Vec<_>>();
        return provider_online(
            profile,
            scan,
            installed_models,
            loaded_models,
            Some("Whisper OpenAI-compatible audio endpoint is reachable.".to_owned()),
        );
    }

    provider_offline(profile, scan, "Whisper server endpoint is not reachable.")
}

fn inspect_piper(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
) -> ProviderSnapshot {
    let online = client
        .get(format!("{}/voices", profile.endpoint_url))
        .send()
        .and_then(|response| response.error_for_status())
        .is_ok()
        || client
            .get(&profile.endpoint_url)
            .send()
            .and_then(|response| response.error_for_status())
            .is_ok();

    if online {
        return provider_online(
            profile.clone(),
            scan,
            offline_models_for_profile(&profile),
            Vec::new(),
            Some("Piper TTS sidecar is reachable.".to_owned()),
        );
    }

    provider_offline(profile, scan, "Piper TTS sidecar is not running.")
}

fn inspect_huggingface_cache(profile: ProviderProfile, scan: ProviderScan) -> ProviderSnapshot {
    let installed_models = offline_models_for_profile(&profile);
    let installed = !installed_models.is_empty() || scan.installed;
    ProviderSnapshot {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        capabilities: profile.capabilities,
        base_url: profile.base_url,
        endpoint_url: profile.endpoint_url,
        status: if installed {
            ProviderStatus::Degraded
        } else {
            ProviderStatus::Offline
        },
        message: Some(if installed {
            "Local Hugging Face cache catalog; serve compatible rows through an installed runtime."
                .to_owned()
        } else {
            "No Hugging Face cache entries found.".to_owned()
        }),
        manageable: installed,
        scan,
        installed_models,
        loaded_models: Vec::new(),
        endpoints: Vec::new(),
    }
}

fn inspect_openai_compatible(
    client: &Client,
    profile: ProviderProfile,
    scan: ProviderScan,
    message: Option<String>,
) -> ProviderSnapshot {
    let models_url = format!("{}/models", profile.endpoint_url);
    let models = client
        .get(models_url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<OpenAiModelsResponse>());

    let Ok(models) = models else {
        return provider_offline(
            profile,
            scan,
            "OpenAI-compatible /models endpoint is not reachable.",
        );
    };

    let installed_models = models
        .data
        .into_iter()
        .map(|model| ModelInfo {
            name: model.id,
            size_bytes: None,
            family: None,
            quantization: None,
            modified_at: None,
            source_path: None,
            capabilities: profile.capabilities.clone(),
            model_format: Some("openai-api".to_owned()),
            serve_targets: vec!["openai".to_owned()],
        })
        .collect::<Vec<_>>();

    let loaded_models = installed_models
        .iter()
        .map(|model| LoadedModel {
            name: model.name.clone(),
            size_bytes: None,
            vram_bytes: None,
            expires_at: None,
            endpoint_url: Some(profile.endpoint_url.clone()),
        })
        .collect::<Vec<_>>();

    provider_online(profile, scan, installed_models, loaded_models, message)
}

fn provider_online(
    profile: ProviderProfile,
    scan: ProviderScan,
    installed_models: Vec<ModelInfo>,
    loaded_models: Vec<LoadedModel>,
    message: Option<String>,
) -> ProviderSnapshot {
    let manageable = profile.manageable();
    let endpoints = endpoints_for_profile(&profile);
    ProviderSnapshot {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        capabilities: profile.capabilities,
        base_url: profile.base_url,
        endpoint_url: profile.endpoint_url,
        status: ProviderStatus::Online,
        message,
        manageable,
        scan,
        installed_models,
        loaded_models,
        endpoints,
    }
}

fn provider_offline(
    profile: ProviderProfile,
    scan: ProviderScan,
    message: &str,
) -> ProviderSnapshot {
    let manageable = profile.manageable();
    let endpoints = endpoints_for_profile(&profile);
    let installed_models = offline_models_for_profile(&profile);
    let message = if scan.installed {
        format!("{message} Installed locally: {}", scan.summary)
    } else {
        message.to_owned()
    };
    ProviderSnapshot {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        capabilities: profile.capabilities,
        base_url: profile.base_url,
        endpoint_url: profile.endpoint_url,
        status: ProviderStatus::Offline,
        message: Some(message),
        manageable,
        scan,
        installed_models,
        loaded_models: Vec::new(),
        endpoints,
    }
}

fn load_ollama(
    client: &Client,
    profile: &ProviderProfile,
    request: &LoadRequest,
) -> Result<ActionResult, String> {
    let keep_alive = request
        .keep_alive
        .clone()
        .unwrap_or_else(|| "30m".to_owned());
    let response = client
        .post(format!("{}/api/generate", profile.base_url))
        .json(&json!({
            "model": request.model,
            "prompt": "",
            "stream": false,
            "keep_alive": keep_alive
        }))
        .send()
        .map_err(|err| format!("Ollama load request failed: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned {}", response.status()));
    }

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(request.model.clone()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Loaded {} through Ollama.", request.model),
    })
}

fn unload_ollama(
    client: &Client,
    profile: &ProviderProfile,
    model: &str,
) -> Result<ActionResult, String> {
    let response = client
        .post(format!("{}/api/generate", profile.base_url))
        .json(&json!({
            "model": model,
            "prompt": "",
            "stream": false,
            "keep_alive": 0
        }))
        .send()
        .map_err(|err| format!("Ollama unload request failed: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned {}", response.status()));
    }

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Unloaded {} from Ollama.", model),
    })
}

fn start_profile_service(profile: &ProviderProfile, model: &str) -> Result<ActionResult, String> {
    let service = profile.user_service.as_ref().ok_or_else(|| {
        format!(
            "{} does not expose a generic runtime load API. Set a MODEL_TRAY_*_USER_SERVICE env var for an owned user service profile.",
            profile.name
        )
    })?;
    run_user_service_action("start", service)?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Started user service {service}."),
    })
}

fn stop_profile_service(profile: &ProviderProfile, model: &str) -> Result<ActionResult, String> {
    let service = profile.user_service.as_ref().ok_or_else(|| {
        format!(
            "{} is attach-only because no owned user service is configured.",
            profile.name
        )
    })?;
    run_user_service_action("stop", service)?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Stopped user service {service}."),
    })
}

fn start_ollama_serve() -> Result<(), String> {
    Command::new("ollama")
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Failed to launch `ollama serve`: {err}"))?;
    Ok(())
}

fn start_llama_cpp_server(
    profile: &ProviderProfile,
    model_name: &str,
    model_path: &str,
) -> Result<ActionResult, String> {
    let server = find_executable(&[
        "llama-server",
        "~/llama.cpp/build/bin/llama-server",
        "/usr/local/bin/llama-server",
    ])
    .ok_or_else(|| {
        "Could not find `llama-server` in PATH or ~/llama.cpp/build/bin/llama-server.".to_owned()
    })?;

    let (host, port) = endpoint_host_port(&profile.endpoint_url, 8080);

    Command::new(&server)
        .args(["-m", model_path, "--host", &host, "--port", &port])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            format!(
                "Failed to launch `{}` for {}: {err}",
                server.display(),
                model_path
            )
        })?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model_name.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Started llama.cpp with {}.", model_name),
    })
}

fn start_vllm_server(profile: &ProviderProfile, model_name: &str) -> Result<ActionResult, String> {
    let vllm = find_executable(&["vllm", "~/.venvs/vllm/bin/vllm"])
        .ok_or_else(|| "Could not find `vllm` in PATH or ~/.venvs/vllm/bin/vllm.".to_owned())?;
    let (host, port) = endpoint_host_port(&profile.endpoint_url, 8000);

    Command::new(&vllm)
        .args(["serve", model_name, "--host", &host, "--port", &port])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            format!(
                "Failed to launch `{}` for {}: {err}",
                vllm.display(),
                model_name
            )
        })?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model_name.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Started vLLM serving {}.", model_name),
    })
}

fn start_comfyui_server(
    profile: &ProviderProfile,
    selected_model: Option<&str>,
) -> Result<ActionResult, String> {
    let client = http_client();
    if http_ok(&client, &format!("{}/system_stats", profile.base_url))
        || http_ok(&client, &format!("{}/queue", profile.base_url))
    {
        return Ok(ActionResult {
            ok: true,
            provider_id: profile.id.clone(),
            model: selected_model.map(str::to_owned),
            endpoint_url: Some(profile.endpoint_url.clone()),
            message: "ComfyUI is already reachable.".to_owned(),
        });
    }

    if let Some(service) = profile.user_service.as_deref() {
        run_user_service_action("start", service)?;
        wait_for_url(&client, &format!("{}/system_stats", profile.base_url), 30)?;
        return Ok(ActionResult {
            ok: true,
            provider_id: profile.id.clone(),
            model: selected_model.map(str::to_owned),
            endpoint_url: Some(profile.endpoint_url.clone()),
            message: format!("Started ComfyUI user service {service}."),
        });
    }

    if user_service_file_exists("comfyui.service") {
        if run_user_service_action("start", "comfyui.service").is_ok() {
            wait_for_url(&client, &format!("{}/system_stats", profile.base_url), 30)?;
            return Ok(ActionResult {
                ok: true,
                provider_id: profile.id.clone(),
                model: selected_model.map(str::to_owned),
                endpoint_url: Some(profile.endpoint_url.clone()),
                message: "Started ComfyUI user service.".to_owned(),
            });
        }
    }

    let root = discover_comfyui_root()
        .ok_or_else(|| "Could not find a ComfyUI directory with main.py.".to_owned())?;
    let python = comfyui_python(&root)
        .ok_or_else(|| "Could not find python for the ComfyUI launch.".to_owned())?;
    let (host, port) = endpoint_host_port(&profile.base_url, 8188);
    ensure_port_free(&host, &port, &profile.name)?;

    Command::new(&python)
        .args(["main.py", "--listen", &host, "--port", &port])
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Failed to launch ComfyUI from {}: {err}", root.display()))?;

    wait_for_url(&client, &format!("{}/system_stats", profile.base_url), 30)?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: selected_model.map(str::to_owned),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: selected_model
            .map(|model| format!("Started ComfyUI for catalog row {model}."))
            .unwrap_or_else(|| "Started ComfyUI.".to_owned()),
    })
}

fn start_whisper_server(
    profile: &ProviderProfile,
    model_name: &str,
    model: Option<&ModelInfo>,
) -> Result<ActionResult, String> {
    let model = model.ok_or_else(|| "Whisper model row is no longer available.".to_owned())?;
    if !model
        .serve_targets
        .iter()
        .any(|target| target == "whisper-server")
    {
        return Err(format!(
            "{} is a discovered STT asset, but it is not a faster-whisper server target.",
            model.name
        ));
    }

    let client = http_client();
    if http_ok(&client, &format!("{}/models", profile.endpoint_url)) {
        return Ok(ActionResult {
            ok: true,
            provider_id: profile.id.clone(),
            model: Some(model_name.to_owned()),
            endpoint_url: Some(format!("{}/audio/transcriptions", profile.endpoint_url)),
            message: "Whisper server is already reachable.".to_owned(),
        });
    }

    let server = find_executable(&["faster-whisper-server"]).ok_or_else(|| {
        "Could not find `faster-whisper-server` in PATH. Whisper CLI models were discovered, but no server adapter is launch-ready.".to_owned()
    })?;
    preflight_help(&server, "faster-whisper-server")?;

    let (host, port) = endpoint_host_port(&profile.endpoint_url, 9000);
    ensure_port_free(&host, &port, &profile.name)?;

    Command::new(&server)
        .arg(model_name)
        .args(["--host", &host, "--port", &port])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            format!(
                "Failed to launch `{}` for {}: {err}",
                server.display(),
                model_name
            )
        })?;

    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model_name.to_owned()),
        endpoint_url: Some(format!("{}/audio/transcriptions", profile.endpoint_url)),
        message: format!("Started faster-whisper server for {}.", model_name),
    })
}

fn start_piper_tts(profile: &ProviderProfile, model_name: &str) -> Result<ActionResult, String> {
    ensure_piper_sidecar(&profile.base_url, Some(model_name))?;
    Ok(ActionResult {
        ok: true,
        provider_id: profile.id.clone(),
        model: Some(model_name.to_owned()),
        endpoint_url: Some(profile.endpoint_url.clone()),
        message: format!("Piper TTS sidecar is serving voice {model_name}."),
    })
}

fn start_huggingface_cached_model(
    profile: &ProviderProfile,
    model_name: &str,
    model: Option<&ModelInfo>,
) -> Result<ActionResult, String> {
    let model = model.ok_or_else(|| "Hugging Face cache row is no longer available.".to_owned())?;
    if model.serve_targets.iter().any(|target| target == "vllm") {
        return start_vllm_server(&runtime_profile(ProviderKind::Vllm), model_name);
    }
    if model
        .serve_targets
        .iter()
        .any(|target| target == "whisper-server")
    {
        return start_whisper_server(
            &runtime_profile(ProviderKind::Whisper),
            model_name,
            Some(model),
        );
    }
    if model.serve_targets.iter().any(|target| target == "comfyui") {
        return start_comfyui_server(&runtime_profile(ProviderKind::ComfyUi), Some(model_name));
    }

    Err(format!(
        "{} is discovered in the Hugging Face cache, but no installed serve adapter was inferred.",
        profile.name
    ))
}

fn wait_for_url(client: &Client, url: &str, attempts: usize) -> Result<(), String> {
    for _ in 0..attempts {
        if client
            .get(url)
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(350));
    }
    Err(format!("Timed out waiting for {url}"))
}

fn find_executable(candidates: &[&str]) -> Option<PathBuf> {
    for candidate in candidates {
        if candidate.contains('/') {
            let path = expand_home(candidate);
            if path.is_file() {
                return Some(path);
            }
            continue;
        }

        if let Some(path) = find_in_path(candidate) {
            return Some(path);
        }
    }
    None
}

fn find_in_path(command: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join(command))
        .find(|path| path.is_file())
}

fn endpoint_host_port(endpoint_url: &str, default_port: u16) -> (String, String) {
    let without_scheme = endpoint_url
        .strip_prefix("http://")
        .or_else(|| endpoint_url.strip_prefix("https://"))
        .unwrap_or(endpoint_url);
    let authority = without_scheme.split('/').next().unwrap_or("127.0.0.1");
    let mut parts = authority.rsplitn(2, ':');
    let maybe_port = parts.next().unwrap_or_default();
    let maybe_host = parts.next();
    if let Some(host) = maybe_host {
        if maybe_port.parse::<u16>().is_ok() {
            return (host.to_owned(), maybe_port.to_owned());
        }
    }
    (authority.to_owned(), default_port.to_string())
}

fn runtime_profile(kind: ProviderKind) -> ProviderProfile {
    match kind {
        ProviderKind::Vllm => ProviderProfile {
            id: "vllm".to_owned(),
            name: "vLLM".to_owned(),
            kind,
            capabilities: vec!["llm".to_owned()],
            base_url: root_url_from_env("VLLM_BASE_URL", "http://127.0.0.1:8000"),
            endpoint_url: endpoint_url_from_env("VLLM_BASE_URL", "http://127.0.0.1:8000"),
            user_service: env_service("MODEL_TRAY_VLLM_USER_SERVICE"),
        },
        ProviderKind::Whisper => ProviderProfile {
            id: "whisper".to_owned(),
            name: "Whisper STT".to_owned(),
            kind,
            capabilities: vec!["stt".to_owned()],
            base_url: root_url_from_env("WHISPER_BASE_URL", "http://127.0.0.1:9000"),
            endpoint_url: endpoint_url_from_env("WHISPER_BASE_URL", "http://127.0.0.1:9000"),
            user_service: env_service("MODEL_TRAY_WHISPER_USER_SERVICE"),
        },
        ProviderKind::ComfyUi => ProviderProfile {
            id: "comfyui".to_owned(),
            name: "ComfyUI".to_owned(),
            kind,
            capabilities: vec!["image".to_owned()],
            base_url: root_url_from_env("COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            endpoint_url: root_url_from_env("COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            user_service: env_service("MODEL_TRAY_COMFYUI_USER_SERVICE"),
        },
        _ => ProviderProfile {
            id: "runtime".to_owned(),
            name: "Runtime".to_owned(),
            kind,
            capabilities: Vec::new(),
            base_url: String::new(),
            endpoint_url: String::new(),
            user_service: None,
        },
    }
}

fn http_ok(client: &Client, url: &str) -> bool {
    client
        .get(url)
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn ensure_port_free(host: &str, port: &str, provider_name: &str) -> Result<(), String> {
    let port = port
        .parse::<u16>()
        .map_err(|_| format!("Invalid port for {provider_name}: {port}"))?;
    if TcpStream::connect((host, port)).is_ok() {
        return Err(format!(
            "Refusing to launch {provider_name}: {host}:{port} already has a listener."
        ));
    }
    Ok(())
}

fn preflight_help(command: &Path, label: &str) -> Result<(), String> {
    let output = Command::new(command)
        .arg("--help")
        .output()
        .map_err(|err| format!("Failed to preflight {label}: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    Err(format!(
        "{label} was detected but is not launch-ready: {}",
        truncate_for_error(detail, 420)
    ))
}

fn user_service_file_exists(service: &str) -> bool {
    if !is_safe_service_name(service) {
        return false;
    }
    home_dir()
        .map(|home| home.join(".config/systemd/user").join(service).is_file())
        .unwrap_or(false)
}

fn discover_comfyui_root() -> Option<PathBuf> {
    env::var_os("COMFYUI_DIR")
        .map(PathBuf::from)
        .filter(|path| path.join("main.py").is_file())
        .or_else(|| {
            [
                "~/ai/ComfyUI",
                "~/ComfyUI",
                "~/Documents/ComfyUI",
                "~/Documents/Project/Agent-GO/ComfyUI-GGUF",
            ]
            .into_iter()
            .map(expand_home)
            .find(|path| path.join("main.py").is_file())
        })
}

fn comfyui_python(root: &Path) -> Option<PathBuf> {
    [
        root.join("venv/bin/python"),
        root.join(".venv/bin/python"),
        PathBuf::from("python3"),
        PathBuf::from("python"),
    ]
    .into_iter()
    .find(|path| {
        if path.components().count() == 1 {
            return find_in_path(path.to_string_lossy().as_ref()).is_some();
        }
        path.is_file()
    })
    .map(|path| {
        if path.components().count() == 1 {
            find_in_path(path.to_string_lossy().as_ref()).unwrap_or(path)
        } else {
            path
        }
    })
}

fn run_user_service_action(action: &str, service: &str) -> Result<(), String> {
    if !is_safe_service_name(service) {
        return Err(format!("Refusing unsafe user service name: {service}"));
    }

    let output = Command::new("systemctl")
        .args(["--user", action, service])
        .output()
        .map_err(|err| format!("Failed to run systemctl --user {action}: {err}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(if stderr.is_empty() {
        format!("systemctl --user {action} {service} failed")
    } else {
        stderr
    })
}

fn enforce_vram_guard(
    request: &LoadRequest,
    estimate_mb: Option<u64>,
    gpu: &GpuCollection,
) -> Result<(), String> {
    let reserve_mb = configured_vram_reserve_mb();

    let Some(gpu_snapshot) = &gpu.gpu else {
        if request.force {
            return Ok(());
        }
        return Err(format!(
            "GPU state is unavailable. Refusing load without force because VRAM pressure cannot be verified. {}",
            gpu.warning.clone().unwrap_or_default()
        ));
    };

    let Some(estimate_mb) = estimate_mb else {
        if gpu_snapshot.memory_free_mb >= reserve_mb || request.force {
            return Ok(());
        }
        return Err(format!(
            "Only {} MB VRAM free and no model estimate is available. Force is required below the {} MB reserve.",
            gpu_snapshot.memory_free_mb, reserve_mb
        ));
    };

    if gpu_snapshot.memory_free_mb < estimate_mb {
        return Err(format!(
            "Refusing load: model estimate is {} MB but only {} MB VRAM is free.",
            estimate_mb, gpu_snapshot.memory_free_mb
        ));
    }

    let projected_free = gpu_snapshot.memory_free_mb - estimate_mb;
    if projected_free < reserve_mb && !request.force {
        return Err(format!(
            "Projected free VRAM is {} MB after loading; reserve is {} MB. Re-run with force if this is intentional.",
            projected_free, reserve_mb
        ));
    }

    Ok(())
}

fn requires_vram_guard(profile: &ProviderProfile, model: Option<&ModelInfo>) -> bool {
    match profile.kind {
        ProviderKind::Ollama
        | ProviderKind::Vllm
        | ProviderKind::LlamaCpp
        | ProviderKind::ComfyUi => true,
        ProviderKind::HuggingFace => model
            .map(|model| {
                model
                    .serve_targets
                    .iter()
                    .any(|target| matches!(target.as_str(), "vllm" | "comfyui"))
                    || model
                        .capabilities
                        .iter()
                        .any(|capability| matches!(capability.as_str(), "llm" | "image"))
            })
            .unwrap_or(false),
        ProviderKind::LmStudio | ProviderKind::OpenAiCompatible => profile.user_service.is_some(),
        ProviderKind::Whisper | ProviderKind::PiperTts => false,
    }
}

fn find_profile(
    profiles: &[ProviderProfile],
    provider_id: &str,
) -> Result<ProviderProfile, String> {
    profiles
        .iter()
        .find(|profile| profile.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))
}

fn validate_model_name(model: &str) -> Result<(), String> {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.len() > 256 {
        return Err("Model name must be 1-256 characters.".to_owned());
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, ';' | '|' | '&' | '>' | '<' | '`'))
    {
        return Err("Model name contains unsupported shell-control characters.".to_owned());
    }
    Ok(())
}

fn is_safe_service_name(service: &str) -> bool {
    service.ends_with(".service")
        && service.len() <= 128
        && service
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '@'))
}

fn estimate_vram_mb(size_bytes: Option<u64>) -> Option<u64> {
    size_bytes.map(|bytes| {
        let size_mb = bytes.div_ceil(MIB);
        size_mb.saturating_mul(13).div_ceil(10).saturating_add(512)
    })
}

fn offline_models_for_profile(profile: &ProviderProfile) -> Vec<ModelInfo> {
    let mut models = match profile.kind {
        ProviderKind::Ollama => ollama_manifest_models(),
        ProviderKind::Vllm => huggingface_cache_models(),
        ProviderKind::LlamaCpp => gguf_models(&[
            env::var("MODELS_DIR").unwrap_or_else(|_| "~/.local/share/models".to_owned()),
            "~/Models".to_owned(),
            "~/llama.cpp/models".to_owned(),
            "~/Documents/INIT/models".to_owned(),
        ]),
        ProviderKind::LmStudio => local_model_files(&[
            "~/.cache/lm-studio/models".to_owned(),
            "~/.lmstudio/models".to_owned(),
            "~/.local/share/LM Studio/models".to_owned(),
        ]),
        ProviderKind::ComfyUi => comfyui_models(),
        ProviderKind::Whisper => whisper_models(),
        ProviderKind::PiperTts => piper_models(),
        ProviderKind::HuggingFace => huggingface_cache_models(),
        ProviderKind::OpenAiCompatible => Vec::new(),
    };

    models.sort_by(|a, b| a.name.cmp(&b.name));
    models.dedup_by(|a, b| a.name == b.name);
    models
}

fn ollama_manifest_models() -> Vec<ModelInfo> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let root = home.join(".ollama/models/manifests");
    let mut manifest_paths = Vec::new();
    collect_files(
        &root,
        0,
        6,
        &mut manifest_paths,
        &|path| path.is_file(),
        512,
    );

    manifest_paths
        .into_iter()
        .filter_map(|path| {
            let name = ollama_name_from_manifest_path(&root, &path)?;
            let size_bytes = ollama_manifest_size(&path);
            Some(ModelInfo {
                name,
                size_bytes,
                family: Some("ollama".to_owned()),
                quantization: None,
                modified_at: file_modified_iso(&path),
                source_path: Some(path.display().to_string()),
                capabilities: vec!["llm".to_owned()],
                model_format: Some("ollama-manifest".to_owned()),
                serve_targets: vec!["ollama".to_owned()],
            })
        })
        .collect()
}

fn ollama_name_from_manifest_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let parts = relative
        .iter()
        .filter_map(|part| part.to_str())
        .collect::<Vec<_>>();
    if parts.len() < 4 {
        return None;
    }

    let namespace = parts[1];
    let model = parts[2];
    let tag = parts[3..].join("/");
    if namespace == "library" {
        Some(format!("{model}:{tag}"))
    } else {
        Some(format!("{namespace}/{model}:{tag}"))
    }
}

fn ollama_manifest_size(path: &Path) -> Option<u64> {
    let value = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())?;
    let mut size = value
        .get("config")
        .and_then(|config| config.get("size"))
        .and_then(|size| size.as_u64())
        .unwrap_or(0);
    if let Some(layers) = value.get("layers").and_then(|layers| layers.as_array()) {
        size += layers
            .iter()
            .filter_map(|layer| layer.get("size").and_then(|size| size.as_u64()))
            .sum::<u64>();
    }
    (size > 0).then_some(size)
}

fn gguf_models(roots: &[String]) -> Vec<ModelInfo> {
    let mut files = Vec::new();
    for root in roots {
        let root = expand_home(root);
        collect_files(
            &root,
            0,
            4,
            &mut files,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("gguf"))
                    .unwrap_or(false)
            },
            512,
        );
    }

    files
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| !name.starts_with("ggml-vocab"))
                .unwrap_or(false)
        })
        .map(|path| model_info_from_file(path, "gguf", &["llm"], &["llama-cpp"]))
        .collect()
}

fn local_model_files(roots: &[String]) -> Vec<ModelInfo> {
    let mut files = Vec::new();
    for root in roots {
        let root = expand_home(root);
        collect_files(
            &root,
            0,
            5,
            &mut files,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| {
                        extension.eq_ignore_ascii_case("gguf")
                            || extension.eq_ignore_ascii_case("safetensors")
                            || extension.eq_ignore_ascii_case("bin")
                    })
                    .unwrap_or(false)
            },
            512,
        );
    }
    files
        .into_iter()
        .map(|path| model_info_from_file(path, "local", &["llm"], &[]))
        .collect()
}

fn huggingface_cache_models() -> Vec<ModelInfo> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let root = home.join(".cache/huggingface/hub");
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    entries
        .flatten()
        .take(1024)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let name = path.file_name()?.to_str()?;
            let model_name = name.strip_prefix("models--")?.replace("--", "/");
            let capabilities = infer_hf_capabilities(&model_name);
            let serve_targets = infer_hf_serve_targets(&model_name, &capabilities);
            Some(ModelInfo {
                name: model_name,
                size_bytes: None,
                family: Some("huggingface".to_owned()),
                quantization: None,
                modified_at: file_modified_iso(&path),
                source_path: Some(path.display().to_string()),
                capabilities,
                model_format: Some("hf-cache".to_owned()),
                serve_targets,
            })
        })
        .collect()
}

fn comfyui_models() -> Vec<ModelInfo> {
    let mut roots = env_paths("COMFYUI_MODEL_DIR");
    roots.extend(env_paths("COMFYUI_MODELS_DIR"));
    roots.extend([
        expand_home("~/ai/ComfyUI/models"),
        expand_home("~/ComfyUI/models"),
        expand_home("~/Documents/ComfyUI/models"),
        expand_home("~/Documents/Project/Agent-GO/ComfyUI-GGUF/models"),
    ]);

    let mut files = Vec::new();
    for root in roots {
        collect_files(
            &root,
            0,
            5,
            &mut files,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| {
                        matches!(
                            extension.to_ascii_lowercase().as_str(),
                            "safetensors" | "ckpt" | "pt" | "pth" | "gguf" | "onnx" | "bin"
                        )
                    })
                    .unwrap_or(false)
            },
            2048,
        );
    }

    files
        .into_iter()
        .map(|path| {
            let family = comfyui_family(&path);
            let mut model = model_info_from_file(path, &family, &["image"], &["comfyui"]);
            model.name = model
                .source_path
                .as_deref()
                .map(comfyui_display_name)
                .unwrap_or(model.name);
            model
        })
        .collect()
}

fn whisper_models() -> Vec<ModelInfo> {
    let mut models = Vec::new();
    let mut roots = env_paths("WHISPER_MODEL_DIR");
    roots.push(expand_home("~/.cache/whisper"));

    for root in roots {
        let mut files = Vec::new();
        collect_files(
            &root,
            0,
            2,
            &mut files,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("pt"))
                    .unwrap_or(false)
            },
            128,
        );
        models.extend(
            files
                .into_iter()
                .map(|path| model_info_from_file(path, "openai-whisper", &["stt"], &["cli-only"])),
        );
    }

    models.extend(
        huggingface_cache_models()
            .into_iter()
            .filter(|model| model.name.to_ascii_lowercase().contains("whisper"))
            .map(|mut model| {
                model.family = Some("faster-whisper".to_owned());
                model.capabilities = vec!["stt".to_owned()];
                model.serve_targets = vec!["whisper-server".to_owned()];
                model
            }),
    );

    models
}

fn piper_models() -> Vec<ModelInfo> {
    let mut roots = env_paths("PIPER_MODEL_DIR");
    roots.extend(env_paths("PIPER_VOICE_DIR"));
    roots.extend([
        expand_home("~/Documents/INIT/models/piper"),
        expand_home("~/.local/share/piper"),
        expand_home("~/Models/piper"),
        expand_home("~/piper/models"),
    ]);

    let mut files = Vec::new();
    for root in roots {
        collect_files(
            &root,
            0,
            4,
            &mut files,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("onnx"))
                    .unwrap_or(false)
            },
            256,
        );
    }

    files
        .into_iter()
        .map(|path| model_info_from_file(path, "piper-voice", &["tts"], &["piper-sidecar"]))
        .collect()
}

fn model_info_from_file(
    path: PathBuf,
    family: &str,
    capabilities: &[&str],
    serve_targets: &[&str],
) -> ModelInfo {
    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_owned();
    let size_bytes = fs::metadata(&path).ok().map(|metadata| metadata.len());
    ModelInfo {
        name,
        size_bytes,
        family: Some(family.to_owned()),
        quantization: None,
        modified_at: file_modified_iso(&path),
        source_path: Some(path.display().to_string()),
        capabilities: capabilities
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        model_format: path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        serve_targets: serve_targets
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

fn collect_files(
    root: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<PathBuf>,
    predicate: &dyn Fn(&Path) -> bool,
    max_files: usize,
) {
    if out.len() >= max_files || depth > max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten().take(1024) {
        if out.len() >= max_files {
            return;
        }
        let path = entry.path();
        if predicate(&path) {
            out.push(path);
        } else if path.is_dir() {
            collect_files(&path, depth + 1, max_depth, out, predicate, max_files);
        }
    }
}

fn file_modified_iso(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| format!("{}", duration.as_secs()))
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn env_paths(key: &str) -> Vec<PathBuf> {
    env::var_os(key)
        .into_iter()
        .flat_map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .collect()
}

fn comfyui_family(path: &Path) -> String {
    let parts = path
        .iter()
        .filter_map(|part| part.to_str())
        .collect::<Vec<_>>();
    parts
        .windows(2)
        .find_map(|window| (window[0] == "models").then(|| window[1].to_owned()))
        .unwrap_or_else(|| "comfyui".to_owned())
}

fn comfyui_display_name(path: &str) -> String {
    let path = Path::new(path);
    let parts = path
        .iter()
        .filter_map(|part| part.to_str())
        .collect::<Vec<_>>();
    if let Some(index) = parts.iter().position(|part| *part == "models") {
        if index + 1 < parts.len() {
            return parts[index + 1..].join("/");
        }
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_owned()
}

fn infer_hf_capabilities(model_name: &str) -> Vec<String> {
    let lowered = model_name.to_ascii_lowercase();
    if lowered.contains("whisper") {
        return vec!["stt".to_owned()];
    }
    if lowered.contains("tts") || lowered.contains("bark") || lowered.contains("piper") {
        return vec!["tts".to_owned()];
    }
    if lowered.contains("sam")
        || lowered.contains("siglip")
        || lowered.contains("clip")
        || lowered.contains("diffusion")
        || lowered.contains("flux")
        || lowered.contains("image")
        || lowered.contains("vision")
    {
        return vec!["image".to_owned(), "cache".to_owned()];
    }
    if lowered.contains("embed") || lowered.contains("bge") || lowered.contains("e5") {
        return vec!["embedding".to_owned(), "cache".to_owned()];
    }
    vec!["llm".to_owned(), "cache".to_owned()]
}

fn infer_hf_serve_targets(model_name: &str, capabilities: &[String]) -> Vec<String> {
    let lowered = model_name.to_ascii_lowercase();
    if lowered.contains("faster-whisper") {
        return vec!["whisper-server".to_owned()];
    }
    if capabilities.iter().any(|capability| capability == "llm") {
        return vec!["vllm".to_owned()];
    }
    if capabilities.iter().any(|capability| capability == "image")
        && (lowered.contains("diffusion") || lowered.contains("flux") || lowered.contains("image"))
    {
        return vec!["comfyui".to_owned()];
    }
    Vec::new()
}

fn endpoints_for_profile(profile: &ProviderProfile) -> Vec<EndpointInfo> {
    match profile.kind {
        ProviderKind::ComfyUi => vec![
            EndpointInfo {
                label: "ComfyUI".to_owned(),
                url: profile.endpoint_url.clone(),
                kind: "base-url".to_owned(),
            },
            EndpointInfo {
                label: "Queue".to_owned(),
                url: format!("{}/queue", profile.base_url),
                kind: "queue".to_owned(),
            },
            EndpointInfo {
                label: "System stats".to_owned(),
                url: format!("{}/system_stats", profile.base_url),
                kind: "metrics".to_owned(),
            },
        ],
        ProviderKind::Whisper => vec![
            EndpointInfo {
                label: "Whisper base".to_owned(),
                url: profile.endpoint_url.clone(),
                kind: "base-url".to_owned(),
            },
            EndpointInfo {
                label: "Transcriptions".to_owned(),
                url: format!("{}/audio/transcriptions", profile.endpoint_url),
                kind: "stt".to_owned(),
            },
            EndpointInfo {
                label: "Models".to_owned(),
                url: format!("{}/models", profile.endpoint_url),
                kind: "models".to_owned(),
            },
        ],
        ProviderKind::PiperTts => vec![
            EndpointInfo {
                label: "Piper TTS".to_owned(),
                url: profile.endpoint_url.clone(),
                kind: "tts".to_owned(),
            },
            EndpointInfo {
                label: "Voices".to_owned(),
                url: format!("{}/voices", profile.endpoint_url),
                kind: "voices".to_owned(),
            },
        ],
        ProviderKind::HuggingFace => Vec::new(),
        _ => vec![
            EndpointInfo {
                label: "OpenAI base".to_owned(),
                url: profile.endpoint_url.clone(),
                kind: "base-url".to_owned(),
            },
            EndpointInfo {
                label: "Models".to_owned(),
                url: format!("{}/models", profile.endpoint_url),
                kind: "models".to_owned(),
            },
            EndpointInfo {
                label: "Chat completions".to_owned(),
                url: format!("{}/chat/completions", profile.endpoint_url),
                kind: "chat".to_owned(),
            },
        ],
    }
}

fn truncate_for_error(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_owned();
    }
    format!("{}...", &value[..max_len])
}

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_millis(900))
        .connect_timeout(Duration::from_millis(250))
        .user_agent("model-tray/0.1")
        .build()
        .expect("valid reqwest client")
}

fn root_url_from_env(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|value| normalize_root_url(&value))
        .unwrap_or_else(|| normalize_root_url(fallback))
}

fn endpoint_url_from_env(key: &str, fallback: &str) -> String {
    let root = root_url_from_env(key, fallback);
    format!("{root}/v1")
}

fn normalize_root_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/').to_owned();
    trimmed
        .strip_suffix("/v1")
        .unwrap_or(trimmed.as_str())
        .trim_end_matches('/')
        .to_owned()
}

fn env_service(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
    name: String,
    #[serde(default)]
    modified_at: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    details: Option<OllamaDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaDetails {
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    quantization_level: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaPsResponse {
    #[serde(default)]
    models: Vec<OllamaPsModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaPsModel {
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    size_vram: Option<u64>,
    #[serde(default)]
    expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    #[serde(default)]
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}

impl From<OllamaTagModel> for ModelInfo {
    fn from(model: OllamaTagModel) -> Self {
        Self {
            name: model.name,
            size_bytes: model.size,
            family: model
                .details
                .as_ref()
                .and_then(|details| details.family.clone()),
            quantization: model
                .details
                .as_ref()
                .and_then(|details| details.quantization_level.clone()),
            modified_at: model.modified_at,
            source_path: None,
            capabilities: vec!["llm".to_owned()],
            model_format: Some("ollama-api".to_owned()),
            serve_targets: vec!["ollama".to_owned()],
        }
    }
}

impl From<OllamaPsModel> for LoadedModel {
    fn from(model: OllamaPsModel) -> Self {
        Self {
            name: model.name,
            size_bytes: model.size,
            vram_bytes: model.size_vram,
            expires_at: model.expires_at,
            endpoint_url: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_v1_urls() {
        assert_eq!(
            normalize_root_url("http://127.0.0.1:8000/v1/"),
            "http://127.0.0.1:8000"
        );
    }

    #[test]
    fn rejects_unsafe_service_names() {
        assert!(is_safe_service_name("model-tray-vllm.service"));
        assert!(!is_safe_service_name("model-tray-vllm;rm.service"));
        assert!(!is_safe_service_name("model-tray-vllm"));
    }

    #[test]
    fn estimates_vram_with_headroom() {
        assert_eq!(estimate_vram_mb(Some(4 * 1024 * 1024 * 1024)), Some(5837));
    }

    #[test]
    fn infers_huggingface_launch_targets() {
        let whisper_caps = infer_hf_capabilities("mobiuslabsgmbh/faster-whisper-large-v3-turbo");
        assert_eq!(whisper_caps, vec!["stt"]);
        assert_eq!(
            infer_hf_serve_targets(
                "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
                &whisper_caps
            ),
            vec!["whisper-server"]
        );

        let qwen_caps = infer_hf_capabilities("Qwen/Qwen3-8B");
        assert!(qwen_caps.iter().any(|capability| capability == "llm"));
        assert_eq!(
            infer_hf_serve_targets("Qwen/Qwen3-8B", &qwen_caps),
            vec!["vllm"]
        );
    }

    #[test]
    fn derives_comfyui_catalog_names() {
        assert_eq!(
            comfyui_display_name("/home/user/ComfyUI/models/checkpoints/sdxl.safetensors"),
            "checkpoints/sdxl.safetensors"
        );
        assert_eq!(
            comfyui_family(Path::new(
                "/home/user/ComfyUI/models/loras/style.safetensors"
            )),
            "loras"
        );
    }
}
