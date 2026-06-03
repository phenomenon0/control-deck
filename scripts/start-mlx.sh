#!/usr/bin/env bash
# Control Deck MLX loader.
#
# Serves qwen3.5:4b (MLX 4-bit) on :8085 with an OpenAI-compatible /v1 API and
# THINKING DISABLED server-side (--chat-template-args). The deck's .env.local
# points LLM_BASE_URL + OLLAMA_BASE_URL at this endpoint, so all chat runs route
# here. Qwen3 non-thinking sampling (temp 0.7 / top-p 0.8 / top-k 20).
#
# Usage:  bash scripts/start-mlx.sh   (keep running; launch the deck separately)
# Setup once:  python3 -m venv .venv-mlx && .venv-mlx/bin/pip install mlx-lm
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL="${MLX_MODEL:-mlx-community/Qwen3.5-4B-4bit}"
PORT="${MLX_PORT:-8085}"

if [ ! -x ".venv-mlx/bin/python" ]; then
  echo "[start-mlx] .venv-mlx missing — run: python3 -m venv .venv-mlx && .venv-mlx/bin/pip install mlx-lm" >&2
  exit 1
fi

echo "[start-mlx] serving $MODEL on :$PORT (thinking OFF)"
exec .venv-mlx/bin/python -m mlx_lm server \
  --model "$MODEL" --port "$PORT" \
  --chat-template-args '{"enable_thinking":false}' \
  --temp 0.7 --top-p 0.8 --top-k 20
