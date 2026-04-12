"use client";

import type { ToolCallData } from "@/components/chat/ToolCallCard";
import { SearchResultsCard } from "./SearchResultsCard";
import { ImageResultCard } from "./ImageResultCard";
import { AudioResultCard } from "./AudioResultCard";
import { CodeExecutionCard } from "./CodeExecutionCard";
import { MemoryResultCard } from "./MemoryResultCard";

interface ToolResultCardProps {
  tool: ToolCallData;
}

/**
 * Dispatcher component that routes tool results to the appropriate
 * rich interactive card based on the tool name.
 */
export function ToolResultCard({ tool }: ToolResultCardProps) {
  // Only show rich cards for completed tools with results
  if (tool.status !== "complete" || !tool.result) {
    return null;
  }

  switch (tool.name) {
    // Search tools
    case "web_search":
    case "search_web":
    case "searxng_search":
    case "tavily_search":
      return <SearchResultsCard tool={tool} />;

    // Image generation/editing tools
    case "generate_image":
    case "create_image":
    case "edit_image":
    case "img2img":
    case "comfyui_generate":
    case "sdxl_generate":
      return <ImageResultCard tool={tool} />;

    // Audio/TTS tools
    case "generate_audio":
    case "text_to_speech":
    case "tts":
    case "speak":
    case "piper_tts":
    case "kokoro_tts":
      return <AudioResultCard tool={tool} />;

    // Code execution tools
    case "execute_code":
    case "run_code":
    case "python":
    case "javascript":
    case "bash":
    case "shell":
    case "code_interpreter":
      return <CodeExecutionCard tool={tool} />;

    // Memory/vector tools
    case "vector_search":
    case "vector_store":
    case "vector_ingest":
    case "memory_search":
    case "memory_store":
    case "semantic_search":
    case "rag_search":
    case "retrieve":
      return <MemoryResultCard tool={tool} />;

    // Fallback - generic card
    default:
      return <GenericToolCard tool={tool} />;
  }
}

/**
 * Generic fallback card for tools without specialized displays.
 * Shows a compact summary of the tool result.
 */
function GenericToolCard({ tool }: { tool: ToolCallData }) {
  const success = tool.result?.success;
  const message = getResultSummary(tool);
  
  // Don't render for very simple results
  if (!message) return null;

  return (
    <div className="result-card generic-card">
      <div className="result-card-header">
        <span className="result-icon">{getToolIcon(tool.name)}</span>
        <span className="result-title">{formatToolName(tool.name)}</span>
        <span className={`exit-badge ${success ? "success" : "error"}`}>
          {success ? "✓" : "✗"}
        </span>
        {tool.durationMs && (
          <span className="result-duration">
            {tool.durationMs > 1000 
              ? `${(tool.durationMs / 1000).toFixed(1)}s` 
              : `${tool.durationMs}ms`}
          </span>
        )}
      </div>

      <div className="result-card-body">
        <div className="generic-result-message">{message}</div>
        
        {/* Show key parameters if any */}
        {tool.args && Object.keys(tool.args).length > 0 && (
          <div className="generic-params">
            {Object.entries(tool.args)
              .slice(0, 3)
              .map(([key, value]) => (
                <span key={key} className="generic-param">
                  <span className="param-key">{key}:</span>
                  <span className="param-value">{formatValue(value)}</span>
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getResultSummary(tool: ToolCallData): string | null {
  const result = tool.result;
  if (!result) return null;

  if (result.error) return result.error;
  if (result.message) return result.message;

  // Try to extract from data
  if (result.data) {
    const data = result.data as Record<string, unknown>;
    if (typeof data.output === "string") return data.output;
    if (typeof data.result === "string") return data.result;
    if (typeof data.message === "string") return data.message;
    if (typeof data.content === "string") return data.content;
    if (Array.isArray(data.results)) {
      return `Found ${data.results.length} results`;
    }
  }

  if (result.success === true) return "Completed successfully";
  if (result.success === false) return "Operation failed";

  return null;
}

function getToolIcon(name: string): string {
  const iconMap: Record<string, string> = {
    // File operations
    read_file: "📄",
    write_file: "📝",
    list_files: "📁",
    delete_file: "🗑️",
    
    // Web operations
    fetch_url: "🌐",
    screenshot: "📸",
    
    // Database
    sql_query: "🗃️",
    database: "💾",
    
    // Math/calculation
    calculate: "🔢",
    math: "➕",
    
    // API calls
    api_call: "🔌",
    http_request: "📡",
    
    // Default
    default: "⚡",
  };

  return iconMap[name] || iconMap.default;
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .toLowerCase();
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 30 ? value.slice(0, 30) + "..." : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (typeof value === "object" && value !== null) {
    return "{...}";
  }
  return String(value);
}

// Re-export for external use
export { SearchResultsCard, ImageResultCard, AudioResultCard, CodeExecutionCard, MemoryResultCard };
