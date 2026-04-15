use crate::models::{GpuProcess, GpuSnapshot};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct GpuCollection {
    pub gpu: Option<GpuSnapshot>,
    pub warning: Option<String>,
}

pub fn collect_gpu() -> GpuCollection {
    match query_gpu_summary() {
        Ok(mut gpu) => {
            gpu.processes = query_gpu_processes();
            GpuCollection {
                gpu: Some(gpu),
                warning: None,
            }
        }
        Err(message) => GpuCollection {
            gpu: None,
            warning: Some(message),
        },
    }
}

fn query_gpu_summary() -> Result<GpuSnapshot, String> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .map_err(|err| format!("nvidia-smi is unavailable: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if stderr.is_empty() {
            "nvidia-smi failed to read GPU state".to_owned()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout
        .lines()
        .next()
        .ok_or_else(|| "nvidia-smi returned no GPU rows".to_owned())?;
    let parts: Vec<_> = first_line.split(',').map(|part| part.trim()).collect();
    if parts.len() < 5 {
        return Err("nvidia-smi returned an unexpected GPU row".to_owned());
    }

    let memory_used_mb = parse_u64(parts[1], "memory.used")?;
    let memory_total_mb = parse_u64(parts[2], "memory.total")?;
    let utilization_percent = parse_u8(parts[3], "utilization.gpu")?;
    let temperature_c = parse_u16(parts[4], "temperature.gpu")?;
    let memory_free_mb = memory_total_mb.saturating_sub(memory_used_mb);
    let memory_percent = if memory_total_mb == 0 {
        0
    } else {
        ((memory_used_mb * 100) / memory_total_mb).min(100) as u8
    };

    Ok(GpuSnapshot {
        name: parts[0].to_owned(),
        memory_used_mb,
        memory_total_mb,
        memory_free_mb,
        memory_percent,
        utilization_percent,
        temperature_c,
        processes: Vec::new(),
    })
}

fn query_gpu_processes() -> Vec<GpuProcess> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-compute-apps=pid,process_name,used_memory",
            "--format=csv,noheader,nounits",
        ])
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_process_line)
        .collect()
}

fn parse_process_line(line: &str) -> Option<GpuProcess> {
    let parts: Vec<_> = line.split(',').map(|part| part.trim()).collect();
    if parts.len() < 3 {
        return None;
    }

    let pid = parts[0].parse::<u32>().ok()?;
    let process_name = parts[1].to_owned();
    let used_memory_mb = parts[2].parse::<u64>().ok()?;
    let provider_hint = provider_hint(&process_name);

    Some(GpuProcess {
        pid,
        process_name,
        used_memory_mb,
        provider_hint,
    })
}

fn provider_hint(process_name: &str) -> Option<String> {
    let name = process_name.to_ascii_lowercase();
    if name.contains("ollama") {
        Some("ollama".to_owned())
    } else if name.contains("vllm") {
        Some("vllm".to_owned())
    } else if name.contains("llama") {
        Some("llama.cpp".to_owned())
    } else if name.contains("lmstudio") || name.contains("lm-studio") {
        Some("lmstudio".to_owned())
    } else if name.contains("python") || name.contains("torch") {
        Some("python/pytorch".to_owned())
    } else {
        None
    }
}

fn parse_u64(value: &str, label: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| format!("nvidia-smi returned invalid {label}: {value}"))
}

fn parse_u8(value: &str, label: &str) -> Result<u8, String> {
    value
        .parse::<u8>()
        .map_err(|_| format!("nvidia-smi returned invalid {label}: {value}"))
}

fn parse_u16(value: &str, label: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|_| format!("nvidia-smi returned invalid {label}: {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gpu_process_rows() {
        let process = parse_process_line("1234, /usr/bin/python3, 4096").unwrap();
        assert_eq!(process.pid, 1234);
        assert_eq!(process.used_memory_mb, 4096);
        assert_eq!(process.provider_hint.as_deref(), Some("python/pytorch"));
    }
}
