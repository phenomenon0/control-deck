# Model Tray

PC-first tray controller for local model loaders and GPU pressure.

## What is implemented

- Tauri v2 desktop shell with a native tray menu and a static no-build UI.
- Rust provider adapters for:
  - Ollama: `/api/tags`, `/api/ps`, load via `/api/generate`, unload via `keep_alive: 0`.
  - vLLM: OpenAI-compatible `/v1/models` discovery plus `/metrics` health probe.
  - llama.cpp server, LM Studio, and one optional custom OpenAI-compatible endpoint.
- Offline system scanner:
  - Detects commands, desktop entries, known paths, Python packages, user/system unit files, and running processes.
  - Reads Ollama model manifests from `~/.ollama/models/manifests` when Ollama is installed but stopped.
  - Finds GGUF models in `MODELS_DIR`, `~/.local/share/models`, `~/Models`, `~/llama.cpp/models`, and `~/Documents/INIT/models`.
  - Lists Hugging Face cache model names for vLLM-style workflows.
- GPU collector using `nvidia-smi` summary and compute-process queries.
- VRAM guard for loads:
  - Hard-blocks when estimated model VRAM exceeds free VRAM.
  - Requires the UI's force toggle when GPU state is unavailable or projected free VRAM drops below the reserve.
  - Reserve defaults to `2048` MB and can be overridden with `MODEL_TRAY_VRAM_RESERVE_MB`.
- Clipboard copy for provider endpoints through Tauri's clipboard plugin.
- User-service start/stop support for attach-only providers when an owned service is configured.
- Start action for installed-but-stopped Ollama via `ollama serve` as a user process.

## Run

```bash
cd apps/model-tray
npm install
npm run dev
```

The UI has no frontend build step. `npm install` is only needed for the Tauri CLI; Cargo will fetch Rust crates on the first run.

`npm run build` produces the release binary without installer bundling. Use `npm run bundle`
after the host has AppIndicator packaging support available.

## Provider configuration

Default endpoints:

| Provider | Environment override | Default |
| --- | --- | --- |
| Ollama | `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| vLLM | `VLLM_BASE_URL` | `http://127.0.0.1:8000` |
| llama.cpp | `LLAMA_CPP_BASE_URL` | `http://127.0.0.1:8080` |
| LM Studio | `LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234` |
| Custom | `MODEL_TRAY_CUSTOM_BASE_URL` | unset |

Owned user services:

```bash
export MODEL_TRAY_VLLM_USER_SERVICE=model-tray-vllm.service
export MODEL_TRAY_LLAMA_CPP_USER_SERVICE=model-tray-llama-cpp.service
export MODEL_TRAY_CUSTOM_USER_SERVICE=model-tray-custom.service
```

Only `.service` names with ASCII letters, digits, `.`, `_`, `-`, and `@` are accepted. V1 does not use sudo or stop unrelated processes.

## Control Deck integration path

Keep provider control in this tray app. The later Control Deck widget should consume a small localhost API or Tauri sidecar bridge backed by the same Rust adapter layer, rather than duplicating model-loader logic in the Next.js app.
