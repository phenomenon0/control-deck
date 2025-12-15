/**
 * Lite Image Pipeline - ONNX-based Stable Diffusion for CPU inference
 * Uses onnxruntime-node for cross-platform CPU inference
 */

// @ts-ignore - onnxruntime-node types may not be available until installed
import * as ort from "onnxruntime-node";
import path from "path";
import { readFile } from "fs/promises";
import { 
  downloadModel, 
  isModelDownloaded, 
  getModelPath, 
  DEFAULT_MODEL,
  getModelInfo,
} from "./download";

// Tokenizer for CLIP text encoding
interface Tokenizer {
  vocab: Record<string, number>;
  merges: string[];
  encoder: Map<string, number>;
  decoder: Map<number, string>;
  bpeRanks: Map<string, number>;
}

// Pipeline state
let textEncoder: ort.InferenceSession | null = null;
let unet: ort.InferenceSession | null = null;
let vaeDecoder: ort.InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;
let currentModelId: string | null = null;

// Constants
const MAX_LENGTH = 77; // CLIP max sequence length
const LATENT_CHANNELS = 4;
const VAE_SCALE_FACTOR = 8;

/**
 * Load tokenizer from vocab and merges files
 */
async function loadTokenizer(modelPath: string): Promise<Tokenizer> {
  const vocabPath = path.join(modelPath, "tokenizer", "vocab.json");
  const mergesPath = path.join(modelPath, "tokenizer", "merges.txt");
  
  const vocabData = await readFile(vocabPath, "utf-8");
  const mergesData = await readFile(mergesPath, "utf-8");
  
  const vocab: Record<string, number> = JSON.parse(vocabData);
  const merges = mergesData.split("\n").filter(line => line && !line.startsWith("#"));
  
  const encoder = new Map(Object.entries(vocab).map(([k, v]) => [k, v as number]));
  const decoder = new Map(Object.entries(vocab).map(([k, v]) => [v as number, k]));
  
  const bpeRanks = new Map<string, number>();
  merges.forEach((merge, i) => {
    bpeRanks.set(merge, i);
  });
  
  return { vocab, merges, encoder, decoder, bpeRanks };
}

/**
 * BPE tokenization (simplified)
 */
function bpe(token: string, tokenizer: Tokenizer): string[] {
  if (token.length <= 1) return [token];
  
  let word = token.split("");
  
  while (word.length > 1) {
    let minPair: [string, string] | null = null;
    let minRank = Infinity;
    
    for (let i = 0; i < word.length - 1; i++) {
      const pair = `${word[i]} ${word[i + 1]}`;
      const rank = tokenizer.bpeRanks.get(pair);
      if (rank !== undefined && rank < minRank) {
        minRank = rank;
        minPair = [word[i], word[i + 1]];
      }
    }
    
    if (!minPair) break;
    
    const newWord: string[] = [];
    let i = 0;
    while (i < word.length) {
      if (i < word.length - 1 && word[i] === minPair[0] && word[i + 1] === minPair[1]) {
        newWord.push(minPair[0] + minPair[1]);
        i += 2;
      } else {
        newWord.push(word[i]);
        i += 1;
      }
    }
    word = newWord;
  }
  
  return word;
}

/**
 * Tokenize text for CLIP
 */
function tokenize(text: string, tokenizer: Tokenizer): number[] {
  // Simple tokenization - split on whitespace and punctuation
  const tokens: number[] = [49406]; // <|startoftext|>
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, " $& ")
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  for (const word of words) {
    const wordWithSuffix = word + "</w>";
    const bpeTokens = bpe(wordWithSuffix, tokenizer);
    
    for (const bpeToken of bpeTokens) {
      const id = tokenizer.encoder.get(bpeToken);
      if (id !== undefined) {
        tokens.push(id);
      }
    }
    
    if (tokens.length >= MAX_LENGTH - 1) break;
  }
  
  tokens.push(49407); // <|endoftext|>
  
  // Pad to MAX_LENGTH
  while (tokens.length < MAX_LENGTH) {
    tokens.push(49407);
  }
  
  return tokens.slice(0, MAX_LENGTH);
}

/**
 * Initialize the pipeline with a specific model
 */
export async function initPipeline(modelId: string = DEFAULT_MODEL): Promise<void> {
  // Skip if already loaded
  if (currentModelId === modelId && textEncoder && unet && vaeDecoder) {
    return;
  }
  
  // Download model if needed
  if (!await isModelDownloaded(modelId)) {
    console.log(`[Pipeline] Model ${modelId} not found, downloading...`);
    await downloadModel(modelId);
  }
  
  const modelPath = getModelPath(modelId);
  console.log(`[Pipeline] Loading model from ${modelPath}...`);
  
  // Session options for CPU optimization
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  };
  
  // Load sessions
  const textEncoderPath = path.join(modelPath, "text_encoder", "model.onnx");
  const unetPath = path.join(modelPath, "unet", "model.onnx");
  const vaeDecoderPath = path.join(modelPath, "vae_decoder", "model.onnx");
  
  console.log("[Pipeline] Loading text encoder...");
  textEncoder = await ort.InferenceSession.create(textEncoderPath, sessionOptions);
  
  console.log("[Pipeline] Loading UNet...");
  unet = await ort.InferenceSession.create(unetPath, sessionOptions);
  
  console.log("[Pipeline] Loading VAE decoder...");
  vaeDecoder = await ort.InferenceSession.create(vaeDecoderPath, sessionOptions);
  
  console.log("[Pipeline] Loading tokenizer...");
  tokenizer = await loadTokenizer(modelPath);
  
  currentModelId = modelId;
  console.log("[Pipeline] Model loaded successfully");
}

/**
 * Generate random latents
 */
function randomLatents(
  batchSize: number, 
  height: number, 
  width: number, 
  seed?: number
): Float32Array {
  const latentHeight = Math.floor(height / VAE_SCALE_FACTOR);
  const latentWidth = Math.floor(width / VAE_SCALE_FACTOR);
  const size = batchSize * LATENT_CHANNELS * latentHeight * latentWidth;
  
  const latents = new Float32Array(size);
  
  // Simple PRNG for reproducibility
  let s = seed ?? Date.now();
  for (let i = 0; i < size; i++) {
    // Box-Muller transform for normal distribution
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const u1 = (s / 0x7fffffff);
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const u2 = (s / 0x7fffffff);
    
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    latents[i] = z;
  }
  
  return latents;
}

/**
 * Simple scheduler for few-step inference (LCM-style)
 */
function getTimesteps(numSteps: number): number[] {
  // Linear schedule from 999 to 0
  const timesteps: number[] = [];
  for (let i = 0; i < numSteps; i++) {
    timesteps.push(Math.floor(999 * (1 - i / numSteps)));
  }
  return timesteps;
}

/**
 * Run the diffusion pipeline
 */
export async function runPipeline(options: {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  modelId?: string;
}): Promise<Uint8Array> {
  const {
    prompt,
    width = 256,
    height = 256,
    steps = 4,
    seed,
    modelId = DEFAULT_MODEL,
  } = options;
  
  // Initialize if needed
  await initPipeline(modelId);
  
  if (!textEncoder || !unet || !vaeDecoder || !tokenizer) {
    throw new Error("Pipeline not initialized");
  }
  
  console.log(`[Pipeline] Generating: "${prompt.slice(0, 50)}..." (${width}x${height}, ${steps} steps)`);
  const startTime = Date.now();
  
  // 1. Tokenize and encode text
  const inputIds = tokenize(prompt, tokenizer);
  // Note: Some models expect int32, others int64. Try int32 first (more common for ONNX exports)
  const inputIdsTensor = new ort.Tensor("int32", Int32Array.from(inputIds), [1, MAX_LENGTH]);
  
  const textEncoderOutputs = await textEncoder.run({ input_ids: inputIdsTensor });
  const textEmbeddings = textEncoderOutputs.last_hidden_state as ort.Tensor;
  
  // 2. Generate initial latents
  let latents = randomLatents(1, height, width, seed);
  const latentHeight = Math.floor(height / VAE_SCALE_FACTOR);
  const latentWidth = Math.floor(width / VAE_SCALE_FACTOR);
  
  // 3. Diffusion loop
  const timesteps = getTimesteps(steps);
  
  for (let i = 0; i < timesteps.length; i++) {
    const t = timesteps[i];
    
    // Create timestep tensor (some ONNX exports expect float, others int)
    // SD Turbo ONNX typically expects float for timestep
    const timestepTensor = new ort.Tensor("float32", Float32Array.from([t]), [1]);
    
    // Create latent tensor
    const latentTensor = new ort.Tensor("float32", latents, [1, LATENT_CHANNELS, latentHeight, latentWidth]);
    
    // Run UNet
    const unetOutputs = await unet.run({
      sample: latentTensor,
      timestep: timestepTensor,
      encoder_hidden_states: textEmbeddings,
    });
    
    const noisePred = unetOutputs.out_sample as ort.Tensor;
    const noiseData = noisePred.data as Float32Array;
    
    // Simple Euler step
    const alpha = 1 - t / 1000;
    for (let j = 0; j < latents.length; j++) {
      latents[j] = latents[j] - noiseData[j] * (1 - alpha) / Math.sqrt(alpha);
    }
  }
  
  // 4. Decode latents to image
  // Scale latents (VAE expects specific range)
  const scaledLatents = new Float32Array(latents.length);
  for (let i = 0; i < latents.length; i++) {
    scaledLatents[i] = latents[i] / 0.18215;
  }
  
  const latentTensor = new ort.Tensor("float32", scaledLatents, [1, LATENT_CHANNELS, latentHeight, latentWidth]);
  const vaeOutputs = await vaeDecoder.run({ latent_sample: latentTensor });
  const decodedImage = vaeOutputs.sample as ort.Tensor;
  
  // 5. Convert to RGB bytes
  const imageData = decodedImage.data as Float32Array;
  const pixels = new Uint8Array(width * height * 3);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = (y * width + x) * 3;
      
      // Image is CHW format, convert to HWC
      const rIdx = 0 * height * width + y * width + x;
      const gIdx = 1 * height * width + y * width + x;
      const bIdx = 2 * height * width + y * width + x;
      
      // Denormalize from [-1, 1] to [0, 255]
      pixels[pixelIdx + 0] = Math.max(0, Math.min(255, Math.round((imageData[rIdx] + 1) * 127.5)));
      pixels[pixelIdx + 1] = Math.max(0, Math.min(255, Math.round((imageData[gIdx] + 1) * 127.5)));
      pixels[pixelIdx + 2] = Math.max(0, Math.min(255, Math.round((imageData[bIdx] + 1) * 127.5)));
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[Pipeline] Generation complete in ${elapsed}ms`);
  
  return pixels;
}

/**
 * Check if pipeline is initialized
 */
export function isPipelineReady(): boolean {
  return textEncoder !== null && unet !== null && vaeDecoder !== null;
}

/**
 * Unload the pipeline to free memory
 */
export async function unloadPipeline(): Promise<void> {
  if (textEncoder) {
    await textEncoder.release();
    textEncoder = null;
  }
  if (unet) {
    await unet.release();
    unet = null;
  }
  if (vaeDecoder) {
    await vaeDecoder.release();
    vaeDecoder = null;
  }
  tokenizer = null;
  currentModelId = null;
  console.log("[Pipeline] Unloaded");
}
