/**
 * OpenAI-Compatible Tool Definitions
 * Used for models that support native tool calling via OpenAI-compatible API
 * Works with: Ollama, llama-server, vLLM, OpenAI
 */

export interface OpenAIToolParameter {
  type: string;
  description: string;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, OpenAIToolParameter>;
      required: string[];
    };
  };
}

/**
 * Tool definitions in OpenAI-compatible format
 * These are passed to any OpenAI-compatible API (Ollama, llama-server, vLLM, etc.)
 */
export const OPENAI_TOOLS: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image from text description. Use for: photos, artwork, illustrations, diagrams, scenes, visual concepts. Do NOT use for text content (poems, stories, essays, code) - write those directly.",
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
      description: "Search the web for current information. Use for: news, facts, prices, sports scores, research. If results are incomplete, search again with refined queries until you get concrete answers.",
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
  {
    type: "function",
    function: {
      name: "execute_code",
      description: "Execute code and show output. Use when: user says 'run', 'execute', 'test'; asks for 'a program that does X'; wants to see output of calculations, countdowns, algorithms, data processing. Languages: python, javascript, typescript, bash, html, react, threejs.",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language: python, javascript, typescript, bash, html, react, threejs" },
          code: { type: "string", description: "Source code to execute" },
          timeout: { type: "number", description: "Timeout in ms, default 30000" },
        },
        required: ["language", "code"],
      },
    },
  },
];

/**
 * Models known to support native tool calling via OpenAI-compatible API
 * Works with Ollama, llama-server (with --jinja), vLLM (with --enable-auto-tool-choice)
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
  "hermes",      // Nous Hermes models
  "functionary", // Functionary models
];

/**
 * Check if a model supports native tool calling
 */
export function supportsNativeTools(model: string): boolean {
  const modelLower = model.toLowerCase();
  return NATIVE_TOOL_MODELS.some((supported) => modelLower.includes(supported));
}

/**
 * OpenAI-compatible chat message format
 */
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function: {
      name: string;
      arguments: string | Record<string, unknown>;
    };
  }>;
  tool_call_id?: string;
  name?: string; // For tool messages, the tool name
}

/**
 * OpenAI-compatible chat response format
 */
export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

