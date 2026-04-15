use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_VRAM_RESERVE_MB: u64 = 2048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub timestamp_ms: u128,
    pub gpu: Option<GpuSnapshot>,
    pub gpu_warning: Option<String>,
    pub providers: Vec<ProviderSnapshot>,
    pub detected_tools: Vec<ToolScan>,
    pub pressure: PressureSnapshot,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSnapshot {
    pub name: String,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_free_mb: u64,
    pub memory_percent: u8,
    pub utilization_percent: u8,
    pub temperature_c: u16,
    pub processes: Vec<GpuProcess>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuProcess {
    pub pid: u32,
    pub process_name: String,
    pub used_memory_mb: u64,
    pub provider_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub capabilities: Vec<String>,
    pub base_url: String,
    pub endpoint_url: String,
    pub status: ProviderStatus,
    pub message: Option<String>,
    pub manageable: bool,
    pub scan: ProviderScan,
    pub installed_models: Vec<ModelInfo>,
    pub loaded_models: Vec<LoadedModel>,
    pub endpoints: Vec<EndpointInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    Ollama,
    Vllm,
    LlamaCpp,
    LmStudio,
    OpenAiCompatible,
    ComfyUi,
    Whisper,
    PiperTts,
    HuggingFace,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderStatus {
    Online,
    Offline,
    Degraded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub family: Option<String>,
    pub quantization: Option<String>,
    pub modified_at: Option<String>,
    pub source_path: Option<String>,
    pub capabilities: Vec<String>,
    pub model_format: Option<String>,
    pub serve_targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedModel {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub vram_bytes: Option<u64>,
    pub expires_at: Option<String>,
    pub endpoint_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInfo {
    pub label: String,
    pub url: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderScan {
    pub installed: bool,
    pub summary: String,
    pub signals: Vec<ScanSignal>,
    pub services: Vec<ServiceSignal>,
    pub processes: Vec<ProcessSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolScan {
    pub id: String,
    pub name: String,
    pub category: String,
    pub installed: bool,
    pub summary: String,
    pub signals: Vec<ScanSignal>,
    pub services: Vec<ServiceSignal>,
    pub processes: Vec<ProcessSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSignal {
    pub kind: String,
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSignal {
    pub scope: String,
    pub name: String,
    pub state: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSignal {
    pub pid: u32,
    pub command: String,
    pub args: String,
}

impl ProviderScan {
    pub fn unknown() -> Self {
        Self {
            installed: false,
            summary: "Not scanned yet.".to_owned(),
            signals: Vec::new(),
            services: Vec::new(),
            processes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PressureSnapshot {
    pub reserve_mb: u64,
    pub free_mb: Option<u64>,
    pub state: PressureState,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PressureState {
    Unknown,
    Ok,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub keep_alive: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnloadRequest {
    pub provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyEndpointRequest {
    pub endpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartProviderRequest {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub ok: bool,
    pub provider_id: String,
    pub model: Option<String>,
    pub endpoint_url: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub capabilities: Vec<String>,
    pub base_url: String,
    pub endpoint_url: String,
    pub user_service: Option<String>,
}

impl ProviderProfile {
    pub fn manageable(&self) -> bool {
        matches!(
            self.kind,
            ProviderKind::Ollama
                | ProviderKind::LlamaCpp
                | ProviderKind::Vllm
                | ProviderKind::ComfyUi
                | ProviderKind::Whisper
                | ProviderKind::PiperTts
                | ProviderKind::HuggingFace
        ) || self.user_service.is_some()
    }
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub fn configured_vram_reserve_mb() -> u64 {
    std::env::var("MODEL_TRAY_VRAM_RESERVE_MB")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value >= 512)
        .unwrap_or(DEFAULT_VRAM_RESERVE_MB)
}
