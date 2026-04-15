use crate::models::{
    ProcessSignal, ProviderKind, ProviderProfile, ProviderScan, ScanSignal, ServiceSignal, ToolScan,
};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct SystemScan {
    pub providers: HashMap<String, ProviderScan>,
    pub detected_tools: Vec<ToolScan>,
}

#[derive(Debug)]
struct ToolDefinition {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    commands: &'static [&'static str],
    python_modules: &'static [&'static str],
    path_hints: &'static [&'static str],
    desktop_keywords: &'static [&'static str],
    service_names: &'static [&'static str],
    process_keywords: &'static [&'static str],
}

#[derive(Debug, Clone)]
struct ProcessRow {
    pid: u32,
    command: String,
    args: String,
}

pub fn scan_system(profiles: &[ProviderProfile]) -> SystemScan {
    let processes = list_processes();
    let desktop_entries = desktop_entries();
    let site_packages = python_site_package_dirs();

    let providers = profiles
        .iter()
        .map(|profile| {
            let definition = provider_definition(profile);
            let mut scan =
                scan_definition(&definition, &processes, &desktop_entries, &site_packages);
            if let Some(service) = &profile.user_service {
                scan.services.extend(scan_service(service));
                refresh_summary(&mut scan);
            }
            (profile.id.clone(), scan)
        })
        .collect::<HashMap<_, _>>();

    let detected_tools = extra_tool_definitions()
        .into_iter()
        .map(|definition| {
            let scan = scan_definition(&definition, &processes, &desktop_entries, &site_packages);
            ToolScan {
                id: definition.id.to_owned(),
                name: definition.name.to_owned(),
                category: definition.category.to_owned(),
                installed: scan.installed,
                summary: scan.summary,
                signals: scan.signals,
                services: scan.services,
                processes: scan.processes,
            }
        })
        .collect();

    SystemScan {
        providers,
        detected_tools,
    }
}

fn provider_definition(profile: &ProviderProfile) -> ToolDefinition {
    match profile.kind {
        ProviderKind::Ollama => ToolDefinition {
            id: "ollama",
            name: "Ollama",
            category: "LLM runtime",
            commands: &["ollama"],
            python_modules: &[],
            path_hints: &["~/.ollama/models", "~/.ollama"],
            desktop_keywords: &["ollama"],
            service_names: &["ollama.service"],
            process_keywords: &["ollama"],
        },
        ProviderKind::Vllm => ToolDefinition {
            id: "vllm",
            name: "vLLM",
            category: "LLM runtime",
            commands: &["vllm"],
            python_modules: &["vllm"],
            path_hints: &["~/.venvs/vllm/bin/vllm", "~/.config/vllm"],
            desktop_keywords: &["vllm"],
            service_names: &["vllm.service", "model-tray-vllm.service"],
            process_keywords: &["vllm"],
        },
        ProviderKind::LlamaCpp => ToolDefinition {
            id: "llama-cpp",
            name: "llama.cpp",
            category: "LLM runtime",
            commands: &["llama-server", "llama-cli"],
            python_modules: &["llama_cpp"],
            path_hints: &[
                "~/llama.cpp",
                "~/llama.cpp/build/bin/llama-server",
                "~/Models/start-llama-server.sh",
                "~/.local/share/models",
            ],
            desktop_keywords: &["llama"],
            service_names: &[
                "llama-cpp.service",
                "llama-server.service",
                "model-tray-llama-cpp.service",
            ],
            process_keywords: &["llama-server", "llama.cpp"],
        },
        ProviderKind::LmStudio => ToolDefinition {
            id: "lmstudio",
            name: "LM Studio",
            category: "LLM runtime",
            commands: &["lmstudio", "lm-studio"],
            python_modules: &[],
            path_hints: &["~/.cache/lm-studio", "~/.config/LM Studio"],
            desktop_keywords: &["lmstudio", "lm-studio", "lm studio"],
            service_names: &[],
            process_keywords: &["lmstudio", "lm-studio", "lm studio"],
        },
        ProviderKind::OpenAiCompatible => ToolDefinition {
            id: "custom-openai",
            name: "Custom OpenAI-compatible",
            category: "LLM runtime",
            commands: &[],
            python_modules: &[],
            path_hints: &[],
            desktop_keywords: &[],
            service_names: &[],
            process_keywords: &[],
        },
        ProviderKind::ComfyUi => ToolDefinition {
            id: "comfyui",
            name: "ComfyUI",
            category: "image/runtime",
            commands: &["comfy", "comfyui"],
            python_modules: &["comfy"],
            path_hints: &[
                "~/ai/ComfyUI",
                "~/ComfyUI",
                "~/Documents/ComfyUI",
                "~/Documents/Project/Agent-GO/ComfyUI-GGUF",
            ],
            desktop_keywords: &["comfy"],
            service_names: &["comfyui.service"],
            process_keywords: &["comfyui", "comfy", "main.py --listen"],
        },
        ProviderKind::Whisper => ToolDefinition {
            id: "whisper",
            name: "Whisper STT",
            category: "speech-to-text",
            commands: &["whisper", "faster-whisper-server"],
            python_modules: &["whisper", "faster_whisper", "faster_whisper_server"],
            path_hints: &["~/.cache/whisper", "~/.cache/huggingface/hub"],
            desktop_keywords: &["whisper", "whispering"],
            service_names: &["whisper.service", "faster-whisper.service"],
            process_keywords: &["whisper", "faster-whisper"],
        },
        ProviderKind::PiperTts => ToolDefinition {
            id: "piper-tts",
            name: "Piper TTS",
            category: "text-to-speech",
            commands: &["piper", "piper-tts"],
            python_modules: &["piper"],
            path_hints: &[
                "~/Documents/INIT/models/piper",
                "~/.local/share/piper",
                "~/Models/piper",
                "~/piper/models",
            ],
            desktop_keywords: &["piper"],
            service_names: &["piper.service", "piper-tts.service"],
            process_keywords: &["piper"],
        },
        ProviderKind::HuggingFace => ToolDefinition {
            id: "huggingface",
            name: "Hugging Face Cache",
            category: "model cache",
            commands: &["huggingface-cli", "hf"],
            python_modules: &["huggingface_hub", "transformers", "diffusers"],
            path_hints: &["~/.cache/huggingface/hub"],
            desktop_keywords: &[],
            service_names: &[],
            process_keywords: &[],
        },
    }
}

fn extra_tool_definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        id: "pytorch",
        name: "PyTorch",
        category: "framework",
        commands: &[],
        python_modules: &["torch"],
        path_hints: &[],
        desktop_keywords: &[],
        service_names: &[],
        process_keywords: &["torchrun", "python"],
    }]
}

fn scan_definition(
    definition: &ToolDefinition,
    processes: &[ProcessRow],
    desktop_entries: &[PathBuf],
    site_packages: &[PathBuf],
) -> ProviderScan {
    let mut signals = Vec::new();
    let mut services = Vec::new();

    for command in definition.commands {
        for path in command_paths(command) {
            signals.push(ScanSignal {
                kind: "command".to_owned(),
                label: (*command).to_owned(),
                value: path.display().to_string(),
            });
        }
    }

    for module in definition.python_modules {
        for path in python_module_paths(module, site_packages) {
            signals.push(ScanSignal {
                kind: "python".to_owned(),
                label: (*module).to_owned(),
                value: path.display().to_string(),
            });
        }
    }

    for hint in definition.path_hints {
        if let Some(path) = existing_path(hint) {
            signals.push(ScanSignal {
                kind: "path".to_owned(),
                label: (*hint).to_owned(),
                value: path.display().to_string(),
            });
        }
    }

    for entry in desktop_entries {
        let haystack = entry
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if definition
            .desktop_keywords
            .iter()
            .any(|keyword| haystack.contains(&keyword.to_ascii_lowercase()))
        {
            signals.push(ScanSignal {
                kind: "desktop".to_owned(),
                label: "desktop entry".to_owned(),
                value: entry.display().to_string(),
            });
        }
    }

    for service in definition.service_names {
        services.extend(scan_service(service));
    }

    let matched_processes = processes
        .iter()
        .filter(|process| matches_process(process, definition.process_keywords))
        .take(20)
        .map(|process| ProcessSignal {
            pid: process.pid,
            command: process.command.clone(),
            args: process.args.clone(),
        })
        .collect::<Vec<_>>();

    let installed = !signals.is_empty() || !services.is_empty() || !matched_processes.is_empty();
    let summary = summarize_scan(
        installed,
        signals.len(),
        services.len(),
        matched_processes.len(),
    );

    ProviderScan {
        installed,
        summary,
        signals,
        services,
        processes: matched_processes,
    }
}

fn command_paths(command: &str) -> Vec<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join(command))
        .filter(|path| path.is_file())
        .collect()
}

fn python_site_package_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Some(home) = home_dir() else {
        return dirs;
    };

    let local_lib = home.join(".local/lib");
    collect_python_site_packages(&local_lib, &mut dirs);

    let venvs = home.join(".venvs");
    if let Ok(entries) = fs::read_dir(venvs) {
        for entry in entries.flatten().take(64) {
            collect_python_site_packages(&entry.path().join("lib"), &mut dirs);
        }
    }

    dirs
}

fn collect_python_site_packages(root: &Path, dirs: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten().take(64) {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if name.starts_with("python") {
            let site_packages = path.join("site-packages");
            if site_packages.is_dir() {
                dirs.push(site_packages);
            }
        }
    }
}

fn python_module_paths(module: &str, site_packages: &[PathBuf]) -> Vec<PathBuf> {
    let dist_info_prefix = module.replace('_', "-").to_ascii_lowercase();
    site_packages
        .iter()
        .flat_map(|dir| {
            let mut found = Vec::new();
            let module_path = dir.join(module);
            if module_path.exists() {
                found.push(module_path);
            }
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten().take(512) {
                    let path = entry.path();
                    let name = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    if name.starts_with(&dist_info_prefix)
                        && (name.ends_with(".dist-info") || name.ends_with(".egg-info"))
                    {
                        found.push(path);
                    }
                }
            }
            found
        })
        .collect()
}

fn desktop_entries() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
    ];
    if let Some(home) = home_dir() {
        roots.push(home.join(".local/share/applications"));
        roots.push(home.join(".local/share/flatpak/exports/share/applications"));
    }

    roots
        .into_iter()
        .filter_map(|root| fs::read_dir(root).ok())
        .flat_map(|entries| {
            entries
                .flatten()
                .take(512)
                .map(|entry| entry.path())
                .collect::<Vec<_>>()
        })
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("desktop"))
        .collect()
}

fn scan_service(service: &str) -> Vec<ServiceSignal> {
    let mut signals = Vec::new();
    let mut saw_unit_file = false;

    for (scope, path) in service_file_candidates(service) {
        if path.exists() {
            saw_unit_file = true;
            signals.push(ServiceSignal {
                scope,
                name: service.to_owned(),
                state: "unit-file".to_owned(),
                source: Some(path.display().to_string()),
            });
        }
    }

    if saw_unit_file {
        for scope in ["user", "system"] {
            if let Some(state) = systemctl_state(scope, service) {
                signals.push(ServiceSignal {
                    scope: scope.to_owned(),
                    name: service.to_owned(),
                    state,
                    source: None,
                });
            }
        }
    }

    signals
}

fn service_file_candidates(service: &str) -> Vec<(String, PathBuf)> {
    let mut paths = vec![
        (
            "system".to_owned(),
            PathBuf::from("/etc/systemd/system").join(service),
        ),
        (
            "system".to_owned(),
            PathBuf::from("/usr/lib/systemd/system").join(service),
        ),
        (
            "system".to_owned(),
            PathBuf::from("/lib/systemd/system").join(service),
        ),
    ];
    if let Some(home) = home_dir() {
        paths.push((
            "user".to_owned(),
            home.join(".config/systemd/user").join(service),
        ));
    }
    paths
}

fn systemctl_state(scope: &str, service: &str) -> Option<String> {
    let mut command = Command::new("systemctl");
    if scope == "user" {
        command.arg("--user");
    }
    let output = command.args(["is-active", service]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stdout.is_empty() {
        Some(stdout)
    } else if output.status.success() {
        Some("active".to_owned())
    } else if stderr.contains("could not be found") || stderr.contains("not-found") {
        None
    } else {
        None
    }
}

fn list_processes() -> Vec<ProcessRow> {
    let output = Command::new("ps")
        .args(["-eo", "pid=,comm=,args="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_process_row)
        .collect()
}

fn parse_process_row(line: &str) -> Option<ProcessRow> {
    let trimmed = line.trim();
    let mut parts = trimmed.splitn(3, char::is_whitespace);
    let pid = parts.next()?.parse::<u32>().ok()?;
    let command = parts.next()?.to_owned();
    let args = parts.next().unwrap_or_default().to_owned();
    Some(ProcessRow { pid, command, args })
}

fn matches_process(process: &ProcessRow, keywords: &[&str]) -> bool {
    if keywords.is_empty() {
        return false;
    }
    let haystack = format!("{} {}", process.command, process.args).to_ascii_lowercase();
    keywords
        .iter()
        .any(|keyword| haystack.contains(&keyword.to_ascii_lowercase()))
}

fn existing_path(path: &str) -> Option<PathBuf> {
    let expanded = expand_home(path);
    expanded.exists().then_some(expanded)
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

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

fn refresh_summary(scan: &mut ProviderScan) {
    scan.installed =
        !scan.signals.is_empty() || !scan.services.is_empty() || !scan.processes.is_empty();
    scan.summary = summarize_scan(
        scan.installed,
        scan.signals.len(),
        scan.services.len(),
        scan.processes.len(),
    );
}

fn summarize_scan(
    installed: bool,
    signal_count: usize,
    service_count: usize,
    process_count: usize,
) -> String {
    if !installed {
        return "No local install signals found.".to_owned();
    }

    let mut parts = Vec::new();
    if signal_count > 0 {
        parts.push(format!(
            "{} install signal{}",
            signal_count,
            plural(signal_count)
        ));
    }
    if service_count > 0 {
        parts.push(format!(
            "{} service signal{}",
            service_count,
            plural(service_count)
        ));
    }
    if process_count > 0 {
        parts.push(format!(
            "{} running process{}",
            process_count,
            plural(process_count)
        ));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_parser_handles_args() {
        let row = parse_process_row("1234 python3 python3 -m vllm.entrypoints.openai.api_server")
            .unwrap();
        assert_eq!(row.pid, 1234);
        assert_eq!(row.command, "python3");
        assert!(row.args.contains("vllm"));
    }
}
