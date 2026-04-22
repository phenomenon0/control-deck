export const MODALITY_LABELS = {
  text: "Text",
  vision: "Vision",
  "image-gen": "Image generation",
  "audio-gen": "Audio generation",
  tts: "Text-to-speech",
  stt: "Speech-to-text",
  embedding: "Embeddings",
  rerank: "Rerank",
  "3d-gen": "3D generation",
  "video-gen": "Video generation",
} as const;

export const MODALITY_ORDER = [
  "text",
  "vision",
  "image-gen",
  "audio-gen",
  "tts",
  "stt",
  "embedding",
  "rerank",
  "3d-gen",
  "video-gen",
] as const;
