use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const MAX_TTS_TEXT_BYTES: usize = 8 * 1024;
const MAX_HTTP_BODY_BYTES: usize = 16 * 1024;

static PIPER_SIDECAR_STARTED: AtomicBool = AtomicBool::new(false);
static DEFAULT_PIPER_VOICE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiperTtsRequest {
    text: String,
    #[serde(default)]
    voice: Option<String>,
    #[serde(default)]
    speaker: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiperVoice {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiperVoiceResponse {
    default_voice: Option<String>,
    voices: Vec<PiperVoice>,
}

pub fn ensure_piper_sidecar(base_url: &str, default_voice: Option<&str>) -> Result<(), String> {
    if let Some(voice) = default_voice {
        set_default_piper_voice(voice)?;
    }

    let (host, port) = local_host_port(base_url, 9242)?;
    if TcpStream::connect((host.as_str(), port)).is_ok() {
        return Ok(());
    }

    if PIPER_SIDECAR_STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let listener = TcpListener::bind((host.as_str(), port)).map_err(|err| {
        PIPER_SIDECAR_STARTED.store(false, Ordering::SeqCst);
        format!("Failed to bind Piper sidecar on {host}:{port}: {err}")
    })?;

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            thread::spawn(move || handle_piper_connection(stream));
        }
    });

    Ok(())
}

fn set_default_piper_voice(voice: &str) -> Result<(), String> {
    validate_voice_name(voice)?;
    let mut default = DEFAULT_PIPER_VOICE
        .lock()
        .map_err(|_| "Piper default voice lock is poisoned.".to_owned())?;
    *default = Some(voice.to_owned());
    Ok(())
}

fn handle_piper_connection(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(4)));
    let response = read_http_request(&mut stream).and_then(route_piper_request);
    match response {
        Ok(response) => {
            let _ = stream.write_all(&response);
        }
        Err(err) => {
            let _ = stream.write_all(&json_response(400, &serde_json::json!({ "error": err })));
        }
    }
}

fn route_piper_request(request: HttpRequest) -> Result<Vec<u8>, String> {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/tts/piper") | ("GET", "/tts/piper/voices") => Ok(json_response(
            200,
            &PiperVoiceResponse {
                default_voice: DEFAULT_PIPER_VOICE
                    .lock()
                    .ok()
                    .and_then(|value| value.clone()),
                voices: piper_voice_paths()
                    .into_iter()
                    .map(|path| PiperVoice {
                        name: piper_voice_name(&path),
                        path: path.display().to_string(),
                    })
                    .collect(),
            },
        )),
        ("POST", "/tts/piper") => synthesize_piper_tts(&request.body),
        ("OPTIONS", _) => Ok(empty_response(204)),
        _ => Err("Unknown Piper sidecar route.".to_owned()),
    }
}

fn synthesize_piper_tts(body: &[u8]) -> Result<Vec<u8>, String> {
    if body.len() > MAX_HTTP_BODY_BYTES {
        return Err("Request body is too large.".to_owned());
    }

    let request = serde_json::from_slice::<PiperTtsRequest>(body)
        .map_err(|err| format!("Expected JSON body with text/voice: {err}"))?;
    validate_tts_text(&request.text)?;
    if let Some(voice) = &request.voice {
        validate_voice_name(voice)?;
    }

    let voice_name = request.voice.or_else(|| {
        DEFAULT_PIPER_VOICE
            .lock()
            .ok()
            .and_then(|value| value.clone())
    });
    let voice_path = select_piper_voice(voice_name.as_deref())?;
    let audio = run_piper(&voice_path, &request.text, request.speaker)?;

    Ok(binary_response(200, "audio/wav", &audio))
}

fn run_piper(voice_path: &Path, text: &str, speaker: Option<u32>) -> Result<Vec<u8>, String> {
    let piper = find_piper_binary().ok_or_else(|| {
        "Could not find Piper binary in PATH, PIPER_BINARY, or common model directories.".to_owned()
    })?;

    let mut command = Command::new(&piper);
    command
        .args(["--model", &voice_path.display().to_string()])
        .args(["--output_file", "-"])
        .arg("--quiet")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(data_dir) = piper
        .parent()
        .map(|parent| parent.join("espeak-ng-data"))
        .filter(|path| path.is_dir())
    {
        command.args(["--espeak_data", &data_dir.display().to_string()]);
    }

    if let Some(speaker) = speaker {
        command.args(["--speaker", &speaker.to_string()]);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to launch Piper: {err}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|err| format!("Failed writing text to Piper: {err}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed waiting for Piper: {err}"))?;
    if output.status.success() {
        return Ok(output.stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Piper returned {}: {}",
        output.status,
        truncate_for_error(stderr.trim(), 320)
    ))
}

fn validate_tts_text(text: &str) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Text is required.".to_owned());
    }
    if text.len() > MAX_TTS_TEXT_BYTES {
        return Err(format!(
            "Text is too large; limit is {} bytes.",
            MAX_TTS_TEXT_BYTES
        ));
    }
    if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err("Text contains unsupported control characters.".to_owned());
    }
    Ok(())
}

fn validate_voice_name(voice: &str) -> Result<(), String> {
    let trimmed = voice.trim();
    if trimmed.is_empty() || trimmed.len() > 160 {
        return Err("Voice name must be 1-160 characters.".to_owned());
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':' | ';' | '|' | '&' | '`'))
    {
        return Err("Voice name contains unsupported characters.".to_owned());
    }
    Ok(())
}

fn select_piper_voice(name: Option<&str>) -> Result<PathBuf, String> {
    let voices = piper_voice_paths();
    if voices.is_empty() {
        return Err("No Piper .onnx voices were found.".to_owned());
    }

    if let Some(name) = name {
        let wanted = name.to_ascii_lowercase();
        if let Some(path) = voices.iter().find(|path| {
            piper_voice_name(path).eq_ignore_ascii_case(&wanted)
                || path
                    .file_name()
                    .and_then(|file| file.to_str())
                    .map(|file| file.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
        }) {
            return Ok(path.clone());
        }
        return Err(format!("Unknown Piper voice: {name}"));
    }

    Ok(voices[0].clone())
}

fn piper_voice_paths() -> Vec<PathBuf> {
    let mut roots = env_paths("PIPER_MODEL_DIR");
    roots.extend(env_paths("PIPER_VOICE_DIR"));
    roots.extend([
        expand_home("~/Documents/INIT/models/piper"),
        expand_home("~/.local/share/piper"),
        expand_home("~/Models/piper"),
        expand_home("~/piper/models"),
    ]);

    let mut voices = Vec::new();
    for root in roots {
        collect_files(
            &root,
            0,
            4,
            &mut voices,
            &|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("onnx"))
                    .unwrap_or(false)
            },
            256,
        );
    }
    voices.sort();
    voices.dedup();
    voices
}

fn piper_voice_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_owned()
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let mut header_end = None;

    while buffer.len() <= MAX_HTTP_BODY_BYTES {
        let read = stream
            .read(&mut chunk)
            .map_err(|err| format!("Failed reading request: {err}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if header_end.is_none() {
            header_end = find_header_end(&buffer);
        }
        if let Some(end) = header_end {
            let content_length = parse_content_length(&buffer[..end])?;
            if buffer.len() >= end + content_length {
                break;
            }
        }
    }

    let header_end = header_end.ok_or_else(|| "Malformed HTTP request.".to_owned())?;
    let content_length = parse_content_length(&buffer[..header_end])?;
    if content_length > MAX_HTTP_BODY_BYTES {
        return Err("Request body is too large.".to_owned());
    }
    if buffer.len() < header_end + content_length {
        return Err("Incomplete request body.".to_owned());
    }

    let header = std::str::from_utf8(&buffer[..header_end - 4])
        .map_err(|_| "HTTP headers must be UTF-8.".to_owned())?;
    let mut lines = header.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing HTTP request line.".to_owned())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "Missing HTTP method.".to_owned())?
        .to_owned();
    let raw_path = parts
        .next()
        .ok_or_else(|| "Missing HTTP path.".to_owned())?;
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_owned();
    let body = buffer[header_end..header_end + content_length].to_vec();

    Ok(HttpRequest { method, path, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn parse_content_length(header: &[u8]) -> Result<usize, String> {
    let header =
        std::str::from_utf8(header).map_err(|_| "HTTP headers must be UTF-8.".to_owned())?;
    for line in header.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.eq_ignore_ascii_case("content-length") {
            return value
                .trim()
                .parse::<usize>()
                .map_err(|_| "Invalid content-length header.".to_owned());
        }
    }
    Ok(0)
}

fn json_response<T: Serialize>(status: u16, body: &T) -> Vec<u8> {
    let body = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    binary_response(status, "application/json", &body)
}

fn empty_response(status: u16) -> Vec<u8> {
    binary_response(status, "text/plain", &[])
}

fn binary_response(status: u16, content_type: &str, body: &[u8]) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        _ => "OK",
    };
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend_from_slice(body);
    response
}

fn local_host_port(raw_url: &str, default_port: u16) -> Result<(String, u16), String> {
    let without_scheme = raw_url
        .strip_prefix("http://")
        .ok_or_else(|| "Piper sidecar URL must use http://.".to_owned())?;
    let authority = without_scheme.split('/').next().unwrap_or("127.0.0.1");
    let (host, port) = if let Some((host, port)) = authority.rsplit_once(':') {
        (
            host.to_owned(),
            port.parse::<u16>()
                .map_err(|_| "Piper sidecar port must be numeric.".to_owned())?,
        )
    } else {
        (authority.to_owned(), default_port)
    };
    if !matches!(host.as_str(), "127.0.0.1" | "localhost") {
        return Err("Piper sidecar only binds to localhost.".to_owned());
    }
    Ok((host, port))
}

fn find_piper_binary() -> Option<PathBuf> {
    env::var_os("PIPER_BINARY")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| find_in_path("piper"))
        .or_else(|| find_in_path("piper-tts"))
        .or_else(|| {
            [
                "~/Documents/INIT/models/piper/piper/piper",
                "~/.local/share/piper/piper",
                "~/piper/piper",
            ]
            .into_iter()
            .map(expand_home)
            .find(|path| path.is_file())
        })
}

fn find_in_path(command: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join(command))
        .find(|path| path.is_file())
}

fn env_paths(key: &str) -> Vec<PathBuf> {
    env::var_os(key)
        .into_iter()
        .flat_map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .collect()
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

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn truncate_for_error(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_owned();
    }
    format!("{}...", &value[..max_len])
}
