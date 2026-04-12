#!/bin/bash
# =============================================================================
# Control Deck + Agent-GO Full Stack Startup Script
# =============================================================================
# Starts both servers for full agent capabilities:
# - Agent-GO server (port 4243) - LLM orchestration, tools, agent loop
# - Control Deck (port 3333) - Web UI
#
# Usage:
#   ./start-full-stack.sh           # Start both servers
#   ./start-full-stack.sh stop      # Stop both servers
#   ./start-full-stack.sh restart   # Restart both servers
#   ./start-full-stack.sh status    # Check server status
# =============================================================================

set -e

# Configuration
AGENTGO_DIR="/home/omen/Documents/Project/Agent-GO"
CONTROLDECK_DIR="/home/omen/Documents/INIT/control-deck"
ATLAS_DIR="/home/omen/Documents/Project/Agent-GO/atlas-runtime"
AGENTGO_PORT=4243
CONTROLDECK_PORT=3333

# =============================================================================
# INFERENCE BACKEND: "atlas" or "ollama"
# =============================================================================
INFERENCE_BACKEND="ollama"  # <-- CHANGE THIS TO SWAP: "atlas" or "ollama"

# LLM Configuration
export AGENTGO_LLM_PROVIDER="ollama"  # Agent-GO uses ollama-compatible API
if [ "$INFERENCE_BACKEND" = "atlas" ]; then
    export OLLAMA_MODEL="llama-3.2-3b-instruct-q4_k_m"
else
    export OLLAMA_MODEL="qwen2"  # Use qwen2 for Ollama
fi
# Other models:
# export OLLAMA_MODEL="llama3.2:3b"      # Fast, lightweight
# export OLLAMA_MODEL="deepseek-r1:14b"  # Reasoning model
# export OLLAMA_MODEL="mistral-small:24b" # High quality

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

check_inference() {
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        print_success "$INFERENCE_BACKEND is running on :11434"
        return 0
    else
        return 1
    fi
}

start_inference() {
    if check_inference; then
        print_warning "$INFERENCE_BACKEND already running on port 11434"
        return 0
    fi

    if [ "$INFERENCE_BACKEND" = "atlas" ]; then
        print_status "Starting Atlas inference server (GPU FULL RESIDENT)..."
        cd "$ATLAS_DIR"
        # Use Llama 3.2 3B - fits fully in GPU with KV cache
        MODEL_PATH="/home/omen/.cache/atlas/models/llama-3.2-3b-instruct-q4_k_m.gguf"
        # For 8B model, disable GPU_FULL_RESIDENT or use hybrid mode

        # GPU settings for maximum performance
        export ATLAS_GPU_FULL_RESIDENT=1  # Load all weights to GPU
        export ATLAS_GPU_LAYERS=999       # All layers on GPU

        nohup ./atlas serve -p 11434 -m "$MODEL_PATH" > /tmp/atlas.log 2>&1 &
        sleep 8  # GPU full resident needs more time
        if check_inference; then
            print_success "Atlas started on port 11434 (GPU)"
        else
            print_error "Failed to start Atlas"
            cat /tmp/atlas.log
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

check_agentgo() {
    if curl -s http://localhost:$AGENTGO_PORT/health > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

check_controldeck() {
    if curl -s http://localhost:$CONTROLDECK_PORT > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

start_servers() {
    print_status "Starting Control Deck Full Stack (backend: $INFERENCE_BACKEND)..."
    echo ""

    # Start/check inference backend
    if ! start_inference; then
        exit 1
    fi
    
    # Start Agent-GO
    print_status "Starting Agent-GO server..."
    if check_agentgo; then
        print_warning "Agent-GO already running on port $AGENTGO_PORT"
    else
        cd "$AGENTGO_DIR"
        nohup ./agentgo-server > /tmp/agentgo.log 2>&1 &
        sleep 2
        
        if check_agentgo; then
            print_success "Agent-GO started on port $AGENTGO_PORT (model: $OLLAMA_MODEL)"
        else
            print_error "Failed to start Agent-GO"
            cat /tmp/agentgo.log
            exit 1
        fi
    fi
    
    # Start Control Deck
    print_status "Starting Control Deck..."
    if check_controldeck; then
        print_warning "Control Deck already running on port $CONTROLDECK_PORT"
    else
        cd "$CONTROLDECK_DIR"
        nohup npm run dev > /tmp/controldeck.log 2>&1 &
        sleep 4
        
        if check_controldeck; then
            print_success "Control Deck started on port $CONTROLDECK_PORT"
        else
            print_error "Failed to start Control Deck"
            tail -20 /tmp/controldeck.log
            exit 1
        fi
    fi
    
    echo ""
    print_success "Full stack is running!"
    echo ""
    echo -e "  ${GREEN}Control Deck:${NC}  http://localhost:$CONTROLDECK_PORT/deck/chat"
    echo -e "  ${GREEN}Agent-GO API:${NC}  http://localhost:$AGENTGO_PORT"
    echo -e "  ${GREEN}LLM Model:${NC}     $OLLAMA_MODEL"
    echo ""
    echo "Logs:"
    echo "  Agent-GO:      tail -f /tmp/agentgo.log"
    echo "  Control Deck:  tail -f /tmp/controldeck.log"
    echo ""
}

stop_servers() {
    print_status "Stopping servers..."

    # Stop Control Deck
    if pkill -f "next dev.*3333" 2>/dev/null; then
        print_success "Control Deck stopped"
    else
        print_warning "Control Deck was not running"
    fi

    # Stop Agent-GO
    if pkill -f "agentgo-server" 2>/dev/null; then
        print_success "Agent-GO stopped"
    else
        print_warning "Agent-GO was not running"
    fi

    # Stop inference backend (Atlas only - Ollama managed by systemd)
    stop_inference

    echo ""
    print_success "All servers stopped"
}

show_status() {
    echo ""
    echo "=== Control Deck Stack Status (backend: $INFERENCE_BACKEND) ==="
    echo ""

    # Inference backend
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        models=$(curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -5 | tr '\n' ', ')
        echo -e "$INFERENCE_BACKEND:    ${GREEN}RUNNING${NC} (models: ${models%,})"
    else
        echo -e "$INFERENCE_BACKEND:    ${RED}STOPPED${NC}"
    fi
    
    # Agent-GO
    if check_agentgo; then
        health=$(curl -s http://localhost:$AGENTGO_PORT/health)
        model=$(echo "$health" | grep -o '"model":"[^"]*"' | cut -d'"' -f4)
        echo -e "Agent-GO:      ${GREEN}RUNNING${NC} on :$AGENTGO_PORT (model: $model)"
    else
        echo -e "Agent-GO:      ${RED}STOPPED${NC}"
    fi
    
    # Control Deck
    if check_controldeck; then
        echo -e "Control Deck:  ${GREEN}RUNNING${NC} on :$CONTROLDECK_PORT"
    else
        echo -e "Control Deck:  ${RED}STOPPED${NC}"
    fi
    
    echo ""
}

# Main
case "${1:-start}" in
    start)
        start_servers
        ;;
    stop)
        stop_servers
        ;;
    restart)
        stop_servers
        sleep 2
        start_servers
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
