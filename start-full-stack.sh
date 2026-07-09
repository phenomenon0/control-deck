#!/bin/bash
# =============================================================================
# Control Deck full-stack startup — thin wrapper around process-compose.
# =============================================================================
# Service definitions, health checks, and dependency order live in
# process-compose.yml. This script only resolves env defaults and drives the
# process-compose server over a unix socket.
#
# Usage:
#   ./start-full-stack.sh           # Start everything (detached)
#   ./start-full-stack.sh stop      # Stop everything
#   ./start-full-stack.sh restart   # Restart everything
#   ./start-full-stack.sh status    # Show status
#   ./start-full-stack.sh attach    # Attach the process-compose TUI
#   ./start-full-stack.sh doctor    # Full drift/health check
# =============================================================================

set -e

# Configuration — override any path via env var before invoking this script
CONTROLDECK_DIR="${CONTROLDECK_DIR:-$HOME/Documents/INIT/control-deck}"
ATLAS_DIR="${ATLAS_DIR:-$HOME/Documents/Project/Agent-GO/atlas-runtime}"
export AGENT_TS_PORT="${AGENT_TS_PORT:-4244}"
export CONTROLDECK_PORT="${CONTROLDECK_PORT:-3333}"
S2S_DIR="${S2S_DIR:-$HOME/Documents/Project/footydata/speech-to-speech}"
S2S_ENABLED="${S2S_ENABLED:-1}"
S2S_LAB_URL="${S2S_LAB_URL:-}"
S2S_LAB_HOST="${S2S_LAB_HOST:-}"
S2S_LAB_PORT="${S2S_LAB_PORT:-}"
if [ -n "$S2S_LAB_URL" ]; then
    s2s_lab_authority="${S2S_LAB_URL#*://}"
    s2s_lab_authority="${s2s_lab_authority%%/*}"
    if [[ "$s2s_lab_authority" == *:* ]]; then
        S2S_LAB_HOST="${S2S_LAB_HOST:-${s2s_lab_authority%%:*}}"
        S2S_LAB_PORT="${S2S_LAB_PORT:-${s2s_lab_authority##*:}}"
    else
        S2S_LAB_HOST="${S2S_LAB_HOST:-$s2s_lab_authority}"
    fi
fi
S2S_LAB_HOST="${S2S_LAB_HOST:-127.0.0.1}"
S2S_LAB_PORT="${S2S_LAB_PORT:-7860}"
S2S_LAB_URL="${S2S_LAB_URL:-http://$S2S_LAB_HOST:$S2S_LAB_PORT}"
if [ -n "${S2S_URL:-}" ]; then
    export S2S_URL
fi
export S2S_LAB_URL S2S_LAB_HOST S2S_LAB_PORT S2S_DIR S2S_ENABLED
export LOG_DIR="${LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/control-deck}"
mkdir -p "$LOG_DIR"

# INFERENCE BACKEND: "atlas" or "ollama" — both serve :11434
INFERENCE_BACKEND="${INFERENCE_BACKEND:-ollama}"
if [ "$INFERENCE_BACKEND" = "atlas" ]; then
    export OLLAMA_MODEL="llama-3.2-3b-instruct-q4_k_m"
else
    export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
fi
export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:11434/v1}"
export LLM_MODEL="${LLM_MODEL:-$OLLAMA_MODEL}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_status()  { echo -e "${BLUE}[*]${NC} $1"; }
print_success() { echo -e "${GREEN}[\xE2\x9C\x93]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }

PC_SOCK="$LOG_DIR/process-compose.sock"
pc() { process-compose -U -u "$PC_SOCK" "$@"; }

require_process_compose() {
    if ! command -v process-compose > /dev/null 2>&1; then
        echo "process-compose not found. Install it (pinned in mise.toml):"
        echo "  curl -sL https://github.com/F1bonacc1/process-compose/releases/download/v1.116.0/process-compose_linux_amd64.tar.gz | tar xz -C ~/.local/bin process-compose"
        exit 1
    fi
}

# Atlas is an external binary process-compose doesn't own; start it here if chosen.
start_atlas_if_needed() {
    [ "$INFERENCE_BACKEND" = "atlas" ] || return 0
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        print_warning "inference already running on :11434"
        return 0
    fi
    print_status "Starting Atlas inference server..."
    MODEL_PATH="${ATLAS_MODEL_PATH:-$HOME/.cache/atlas/models/llama-3.2-3b-instruct-q4_k_m.gguf}"
    ATLAS_GPU_FULL_RESIDENT=1 ATLAS_GPU_LAYERS=999 \
        nohup "$ATLAS_DIR/atlas" serve -p 11434 -m "$MODEL_PATH" > "$LOG_DIR/atlas.log" 2>&1 &
    sleep 8
}

start_servers() {
    require_process_compose
    print_status "Doctor (quick) — drift check before start"
    (cd "$CONTROLDECK_DIR" && bun scripts/doctor.ts --quick) || print_warning "doctor reported issues — stack will still start; run './start-full-stack.sh doctor' for details"
    start_atlas_if_needed
    print_status "Starting stack via process-compose (backend: $INFERENCE_BACKEND)..."
    cd "$CONTROLDECK_DIR"
    pc up -f process-compose.yml -D
    sleep 1
    pc process list || true
    echo ""
    print_success "Stack starting (detached). Follow along with: ./start-full-stack.sh attach"
    echo ""
    echo -e "  ${GREEN}Control Deck:${NC}   http://localhost:$CONTROLDECK_PORT/deck/chat"
    echo -e "  ${GREEN}agent-ts:${NC}       http://localhost:$AGENT_TS_PORT"
    echo -e "  ${GREEN}s2s Voice Lab:${NC}  $S2S_LAB_URL"
    echo -e "  ${GREEN}LLM Model:${NC}      $OLLAMA_MODEL"
    echo ""
    echo "Logs: $LOG_DIR/{agent-ts,controldeck,s2s-lab}.log"
}

stop_servers() {
    require_process_compose
    if pc down 2>/dev/null; then
        print_success "Stack stopped"
    else
        print_warning "process-compose server not running (nothing to stop)"
    fi
    if [ "$INFERENCE_BACKEND" = "atlas" ] && pkill -f "atlas serve" 2>/dev/null; then
        print_success "Atlas stopped"
    fi
}

show_status() {
    require_process_compose
    echo ""
    echo "=== Control Deck Stack Status (backend: $INFERENCE_BACKEND) ==="
    pc process list -o wide 2>/dev/null || print_warning "process-compose server not running — stack is down (host services below may still be up)"
    echo ""
    for probe in "inference|http://localhost:11434/api/tags" \
                 "vectordb|http://localhost:4242" \
                 "voice-api|http://localhost:8000" \
                 "s2s lab|$S2S_LAB_URL/v1/voice-lab/status"; do
        name="${probe%%|*}"; url="${probe#*|}"
        # any HTTP status = up; only refused/timed-out connections count as down
        if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$url" 2>/dev/null)" != "000" ]; then
            echo -e "$name:\t${GREEN}UP${NC}"
        else
            echo -e "$name:\t${YELLOW}down${NC}"
        fi
    done
    echo ""
}

case "${1:-start}" in
    start)   start_servers ;;
    stop)    stop_servers ;;
    restart) stop_servers; sleep 2; start_servers ;;
    status)  show_status ;;
    attach)  require_process_compose; pc attach ;;
    doctor)  cd "$CONTROLDECK_DIR" && bun scripts/doctor.ts ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|attach|doctor}"
        exit 1
        ;;
esac
