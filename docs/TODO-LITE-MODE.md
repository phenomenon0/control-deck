# Lite Mode TODO

## Current State

Lite mode is **partially implemented** but the ONNX image generation uses too much memory for the 4-8GB RAM target.

### What Works
- [x] System detection (`lib/system/detect.ts`)
- [x] Mode switching via `CONTROL_DECK_MODE=lite`
- [x] Lite LLM selection (qwen2.5:1.5b)
- [x] ONNX pipeline infrastructure
- [x] B&W post-processing
- [x] SVG vectorization

### Memory Issue

**Benchmark Results (Dec 2024):**

| Component | Memory | Time |
|-----------|--------|------|
| LLM (qwen2.5:1.5b) | ~940 MB | ~250-1700ms |
| ONNX SD Turbo | ~8,400 MB | ~4s/image |
| **Combined** | **~9,400 MB** | **~5s total** |

The SD Turbo ONNX model (jdp8/sd-turbo-onnx) is a full SD 1.5-sized model:
- 1.7GB UNet on disk → ~7-8GB in RAM (FP32 + intermediate tensors)
- Not suitable for 4-8GB RAM machines

---

## TODO: Fix Memory Usage

### Option 1: Quantized ONNX Model (Recommended)
Find or convert an INT8/FP16 quantized model:
- Would reduce memory by ~50-75%
- Target: ~2GB total for image pipeline
- Tools: `optimum-cli` can export quantized ONNX from HuggingFace models

```bash
# Example conversion (needs optimum installed)
optimum-cli export onnx --model stabilityai/sd-turbo \
  --task stable-diffusion \
  --fp16 \
  sd-turbo-fp16-onnx/
```

### Option 2: Smaller Architecture
Use a truly tiny diffusion model:
- **BK-SDM-Tiny** (~350MB) - needs ONNX conversion
- **Tiny SD** architectures exist but need ONNX exports
- Could get down to ~1-2GB RAM

### Option 3: Skip Neural Image Gen
Use `glyph_motif` tool instead of ONNX in lite mode:
- Procedural SVG generation
- Zero additional memory
- Instant generation
- Already implemented and working

To implement, modify `lib/tools/executor.ts`:
```typescript
if (backend === "lite") {
  // Route to glyph instead of ONNX
  return executeGlyphMotif({ prompt: args.prompt, style: "ink" }, ctx);
}
```

### Option 3b: Hybrid Approach
- Use glyph_motif for quick sketches
- Offer ONNX as optional "high quality" mode
- Let user choose based on available RAM

---

## Files Involved

```
lib/system/
├── detect.ts       # Hardware detection
├── profile.ts      # Cached profile singleton
└── index.ts        # Exports

lib/tools/lite-image/
├── download.ts     # Model downloader (DEFAULT_MODEL = "sd-turbo-onnx")
├── pipeline.ts     # ONNX inference pipeline
├── post-process.ts # B&W conversion with sharp
├── styles.ts       # 5 ink styles
└── vectorize.ts    # PNG to SVG

lib/tools/
├── lite-image.ts   # Main lite image export
├── executor.ts     # Routes generate_image to lite/power backend
└── glyph.ts        # Procedural SVG (alternative for lite)

lib/prompts/
└── moby-lite.txt   # Simplified system prompt for lite mode
```

---

## Testing

```bash
# Run lite mode
CONTROL_DECK_MODE=lite npm run dev

# Test system detection
bunx tsx -e "
import { detectSystem, formatSystemProfile } from './lib/system/detect.ts';
console.log(formatSystemProfile(detectSystem()));
"

# Test ONNX pipeline directly (warning: uses ~8GB RAM)
bunx tsx -e "
import { initPipeline, runPipeline } from './lib/tools/lite-image/pipeline.ts';
await initPipeline();
const pixels = await runPipeline({ prompt: 'a rose', width: 256, height: 256, steps: 1 });
console.log('Generated', pixels.length, 'bytes');
"
```

---

## Priority

**Low** - Power mode with ComfyUI works well. Lite mode is a nice-to-have for accessibility on low-spec hardware.

If prioritized, Option 3 (glyph fallback) is the quickest fix. Option 1 (quantized model) would provide better quality but requires finding/converting a suitable model.
