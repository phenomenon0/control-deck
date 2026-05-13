#!/bin/bash
# =============================================================================
# Control Deck full-stack startup
# =============================================================================
# Starts the three processes the chat surface needs:
#   - Inference backend (Ollama by default, Atlas optional)  :11434
#   - agent-ts (pi-agent-core runtime)                       :4244
#   - Control Deck (Next.js UI)                              :3333
#
# Usage:
#   ./start-full-stack.sh           # Start everything
#   ./start-full-stack.sh stop      # Stop everything
#   ./start-full-stack.sh restart   # Restart everything
#   ./start-full-stack.sh status    # Show status
# =============================================================================

set -e

# Configuration — override any path via env var before invoking this script
CONTROLDECK_DIR="${CONTROLDECK_DIR:-$HOME/Documents/INIT/control-deck}"
ATLAS_DIR="${ATLAS_DIR:-$HOME/Documents/Project/Agent-GO/atlas-runtime}"
AGENT_TS_PORT="${AGENT_TS_PORT:-4244}"
CONTROLDECK_PORT="${CONTROLDECK_PORT:-3333}"
LOG_DIR="${LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/control-deck}"
mkdir -p "$LOG_DIR"

# =============================================================================
# INFERENCE BACKEND: "atlas" or "ollama"
# =============================================================================
INFERENCE_BACKEND="ollama"  # <-- CHANGE THIS TO SWAP: "atlas" or "ollama"

# LLM model that agent-ts will request from the inference backend
if [ "$INFERENCE_BACKEND" = "atlas" ]; then
    export OLLAMA_MODEL="llama-3.2-3b-instruct-q4_k_m"
else
    export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2}"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status()  { echo -e "${BLUE}[*]${NC} $1"; }
print_success() { echo -e "${GREEN}[\xE2\x9C\x93]${NC} $1"; }
print_error()   { echo -e "${RED}[\xE2\x9C\x97]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }

check_inference() {
    curl -s http://localhost:11434/api/tags > /dev/null 2>&1
}

start_inference() {
    if check_inference; then
        print_warning "$INFERENCE_BACKEND already running on port 11434"
        return 0
    fi

    if [ "$INFERENCE_BACKEND" = "atlas" ]; then
        print_status "Starting Atlas inference server (GPU FULL RESIDENT)..."
        cd "$ATLAS_DIR"
        MODEL_PATH="${ATLAS_MODEL_PATH:-$HOME/.cache/atlas/models/llama-3.2-3b-instruct-q4_k_m.gguf}"
        export ATLAS_GPU_FULL_RESIDENT=1
        export ATLAS_GPU_LAYERS=999
        nohup ./atlas serve -p 11434 -m "$MODEL_PATH" > "$LOG_DIR/atlas.log" 2>&1 &
        sleep 8
        if check_inference; then
            print_success "Atlas started on port 11434 (GPU)"
        else
            print_error "Failed to start Atlas"
            cat "$LOG_DIR/atlas.log"
            return 1
        fi
    else
        print_error "Ollama is not running!"
        print_warning "Start Ollama first: sudo systemctl start ollama"
        return 1
    fi
}

stop_inference() {
    if [ "$INFERENCE_BACKEND" = "atlas" ]; then
        if pkill -f "atlasd serve" 2>/dev/null; then
            print_success "Atlas stopped"
        else
            print_warning "Atlas was not running"
        fi
    fi
}

check_agent_ts() {
    curl -s http://localhost:$AGENT_TS_PORT/health > /dev/null 2>&1
}

check_controldeck() {
    curl -s http://localhost:$CONTROLDECK_PORT > /dev/null 2>&1
}

start_servers() {
    print_status "Starting Control Deck full stack (backend: $INFERENCE_BACKEND)..."
    echo ""

    if ! start_inference; then
        exit 1
    fi

    # Start agent-ts (pi-agent-core runtime)
    print_status "Starting agent-ts..."
    if check_agent_ts; then
        print_warning "agent-ts already running on port $AGENT_TS_PORT"
    else
        cd "$CONTROLDECK_DIR"
        AGENT_TS_PORT="$AGENT_TS_PORT" \
        nohup npx tsx apps/agent-ts/src/server/main.ts > "$LOG_DIR/agent-ts.log" 2>&1 &
        sleep 3

        if check_agent_ts; then
            print_success "agent-ts started on port $AGENT_TS_PORT (model: $OLLAMA_MODEL)"
        else
            print_error "Failed to start agent-ts"
            tail -40 "$LOG_DIR/agent-ts.log"
            exit 1
        fi
    fi

    # Start Control Deck
    print_status "Starting Control Deck..."
    if check_controldeck; then
        print_warning "Control Deck already running on port $CONTROLDECK_PORT"
    else
        cd "$CONTROLDECK_DIR"
        nohup npm run dev > "$LOG_DIR/controldeck.log" 2>&1 &
        sleep 4

        if check_controldeck; then
            print_success "Control Deck started on port $CONTROLDECK_PORT"
        else
            print_error "Failed to start Control Deck"
            tail -20 "$LOG_DIR/controldeck.log"
            exit 1
        fi
    fi

    echo ""
    print_success "Full stack is running!"
    echo ""
    echo -e "  ${GREEN}Control Deck:${NC}  http://localhost:$CONTROLDECK_PORT/deck/chat"
    echo -e "  ${GREEN}agent-ts:${NC}      http://localhost:$AGENT_TS_PORT"
    echo -e "  ${GREEN}LLM Model:${NC}     $OLLAMA_MODEL"
    echo ""
    echo "Logs:"
    echo "  agent-ts:      tail -f $LOG_DIR/agent-ts.log"
    echo "  Control Deck:  tail -f $LOG_DIR/controldeck.log"
    echo ""
}

stop_servers() {
    print_status "Stopping servers..."

    if pkill -f "next dev.*3333" 2>/dev/null; then
        print_success "Control Deck stopped"
    else
        print_warning "Control Deck was not running"
    fi

    if pkill -f "apps/agent-ts/src/server/main.ts" 2>/dev/null; then
        print_success "agent-ts stopped"
    else
        print_warning "agent-ts was not running"
    fi

    stop_inference

    echo ""
    print_success "All servers stopped"
}

show_status() {
    echo ""
    echo "=== Control Deck Stack Status (backend: $INFERENCE_BACKEND) ==="
    echo ""

    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        models=$(curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -5 | tr '\n' ', ')
        echo -e "$INFERENCE_BACKEND:    ${GREEN}RUNNING${NC} (models: ${models%,})"
    else
        echo -e "$INFERENCE_BACKEND:    ${RED}STOPPED${NC}"
    fi

    if check_agent_ts; then
        health=$(curl -s http://localhost:$AGENT_TS_PORT/health)
        echo -e "agent-ts:      ${GREEN}RUNNING${NC} on :$AGENT_TS_PORT ($health)"
    else
        echo -e "agent-ts:      ${RED}STOPPED${NC}"
    fi

    if check_controldeck; then
        echo -e "Control Deck:  ${GREEN}RUNNING${NC} on :$CONTROLDECK_PORT"
    else
        echo -e "Control Deck:  ${RED}STOPPED${NC}"
    fi

    echo ""
}

case "${1:-start}" in
    start)   start_servers ;;
    stop)    stop_servers ;;
    restart) stop_servers; sleep 2; start_servers ;;
    status)  show_status ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
