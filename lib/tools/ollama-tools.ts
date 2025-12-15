/**
 * Ollama Native Tool Definitions (OpenAI-compatible format)
 * Used for models that support native tool calling (qwen3, llama3.2, mistral, etc.)
 */

export interface OllamaToolParameter {
  type: string;
  description: string;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, OllamaToolParameter>;
      required: string[];
    };
  };
}

/**
 * Tool definitions in Ollama/OpenAI format
 * These are passed directly to the Ollama API
 */
export const OLLAMA_TOOLS: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate a picture/photo/artwork. Use ONLY when user explicitly requests an image, photo, illustration, drawing, render, or visual artwork. Do NOT use for text content like poems, sonnets, stories, essays, lyrics, code, or explanations - write those directly without tools.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed image description (style, mood, colors, composition)" },
          width: { type: "number", description: "Width 512-1024, default 768" },
          height: { type: "number", description: "Height 512-1024, default 768" },
          seed: { type: "number", description: "Random seed" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_image",
      description: "Edit an uploaded image using natural language instructions",
      parameters: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Upload ID of the image to edit" },
          instruction: { type: "string", description: "What to change (e.g., 'make the sky sunset colors', 'remove the car')" },
          seed: { type: "number", description: "Random seed for reproducibility" },
        },
        required: ["image_id", "instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_audio",
      description: "Generate music or audio from a text description using Stable Audio",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description of audio (e.g., 'upbeat electronic dance music with heavy bass')" },
          duration: { type: "number", description: "Duration in seconds, 1-47, default 10" },
          seed: { type: "number", description: "Random seed for reproducibility" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "image_to_3d",
      description: "Convert an uploaded image to a 3D GLB model using Hunyuan 3D",
      parameters: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Upload ID of the input image" },
          seed: { type: "number", description: "Random seed for reproducibility" },
        },
        required: ["image_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_image",
      description: "Analyze and answer questions about an uploaded image using vision AI",
      parameters: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Upload ID of the image to analyze" },
          question: { type: "string", description: "Specific question about the image (optional)" },
        },
        required: ["image_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information (news, prices, recent events)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          max_results: { type: "number", description: "Maximum results 1-10, default 5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glyph_motif",
      description: "ONLY for procedural SVG patterns when user EXPLICITLY requests: sigil, mandala, geometric symbol, rune, or SVG icon. Never use for text content (poems, stories, code). For photos/illustrations use generate_image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Theme for geometric pattern" },
          style: { type: "string", description: "Style: sigil, rune, mandala, circuit, organic" },
          size: { type: "number", description: "Size 64-512 pixels" },
          seed: { type: "number", description: "Random seed" },
          sheet: { type: "boolean", description: "Generate 4x4 spritesheet" },
        },
        required: ["prompt"],
      },
    },
  },
];

/**
 * Models known to support native tool calling via Ollama
 */
export const NATIVE_TOOL_MODELS = [
  "qwen3",
  "qwen2.5", 
  "llama3.2",
  "llama3.1",
  "mistral",
  "mixtral",
  "command-r",
  "firefunction",
];

/**
 * Check if a model supports native tool calling
 */
export function supportsNativeTools(model: string): boolean {
  const modelLower = model.toLowerCase();
  return NATIVE_TOOL_MODELS.some((supported) => modelLower.includes(supported));
}

/**
 * Ollama chat message format
 */
export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  tool_name?: string;
}

/**
 * Ollama chat response format
 */
export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}
