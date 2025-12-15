/**
 * Post-Processing for B&W Ink Style Output
 * Converts AI-generated images to clean black and white
 */

import sharp from "sharp";
import { getStyleConfig, type LiteImageStyle, DEFAULT_STYLE } from "./styles";

export interface PostProcessOptions {
  style?: LiteImageStyle;
  contrast?: number;   // Override style contrast
  threshold?: number;  // Override style threshold
  blur?: number;       // Override style blur
}

/**
 * Convert RGB pixel array to a sharp-compatible buffer
 */
function rgbToBuffer(pixels: Uint8Array, width: number, height: number): Buffer {
  // Create RGBA buffer (sharp prefers RGBA)
  const rgba = Buffer.alloc(width * height * 4);
  
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = pixels[i * 3 + 0]; // R
    rgba[i * 4 + 1] = pixels[i * 3 + 1]; // G
    rgba[i * 4 + 2] = pixels[i * 3 + 2]; // B
    rgba[i * 4 + 3] = 255;                // A
  }
  
  return rgba;
}

/**
 * Apply B&W post-processing to generated image
 * 
 * Pipeline:
 * 1. Convert to grayscale
 * 2. Apply contrast boost
 * 3. Optional blur for smoother edges
 * 4. Apply threshold for pure B&W
 */
export async function postProcess(
  pixels: Uint8Array,
  width: number,
  height: number,
  options: PostProcessOptions = {}
): Promise<Buffer> {
  const style = options.style ?? DEFAULT_STYLE;
  const config = getStyleConfig(style);
  
  const contrast = options.contrast ?? config.postProcess.contrast;
  const threshold = options.threshold ?? config.postProcess.threshold;
  const blur = options.blur ?? config.postProcess.blur;
  
  // Convert to sharp-compatible buffer
  const inputBuffer = rgbToBuffer(pixels, width, height);
  
  // Build processing pipeline
  let pipeline = sharp(inputBuffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  });
  
  // 1. Convert to grayscale
  pipeline = pipeline.grayscale();
  
  // 2. Apply contrast boost using linear transform
  // linear(a, b) applies: output = input * a + b
  // For contrast: a > 1 increases contrast
  pipeline = pipeline.linear(contrast, (1 - contrast) * 128);
  
  // 3. Optional blur for smoother edges before thresholding
  if (blur && blur > 0) {
    pipeline = pipeline.blur(blur);
  }
  
  // 4. Apply threshold for pure B&W
  pipeline = pipeline.threshold(threshold);
  
  // Output as PNG
  return pipeline.png().toBuffer();
}

/**
 * Convert processed image to PNG with metadata
 */
export async function toPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  options: PostProcessOptions = {}
): Promise<Buffer> {
  return postProcess(pixels, width, height, options);
}

/**
 * Get image as raw B&W bitmap (for SVG conversion)
 */
export async function toBitmap(
  pixels: Uint8Array,
  width: number,
  height: number,
  options: PostProcessOptions = {}
): Promise<{ data: Buffer; width: number; height: number }> {
  const style = options.style ?? DEFAULT_STYLE;
  const config = getStyleConfig(style);
  
  const contrast = options.contrast ?? config.postProcess.contrast;
  const threshold = options.threshold ?? config.postProcess.threshold;
  const blur = options.blur ?? config.postProcess.blur;
  
  const inputBuffer = rgbToBuffer(pixels, width, height);
  
  let pipeline = sharp(inputBuffer, {
    raw: { width, height, channels: 4 },
  })
    .grayscale()
    .linear(contrast, (1 - contrast) * 128);
  
  if (blur && blur > 0) {
    pipeline = pipeline.blur(blur);
  }
  
  pipeline = pipeline.threshold(threshold);
  
  // Get raw grayscale buffer
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  
  return {
    data,
    width: info.width,
    height: info.height,
  };
}

/**
 * Quick preview - just grayscale without full processing
 */
export async function toGrayscale(
  pixels: Uint8Array,
  width: number,
  height: number
): Promise<Buffer> {
  const inputBuffer = rgbToBuffer(pixels, width, height);
  
  return sharp(inputBuffer, {
    raw: { width, height, channels: 4 },
  })
    .grayscale()
    .png()
    .toBuffer();
}

/**
 * Apply style-specific enhancements
 */
export async function enhanceForStyle(
  buffer: Buffer,
  style: LiteImageStyle
): Promise<Buffer> {
  const config = getStyleConfig(style);
  
  let pipeline = sharp(buffer);
  
  // Style-specific enhancements
  switch (style) {
    case "stipple":
      // Add slight noise for stipple effect
      pipeline = pipeline.sharpen({ sigma: 0.5 });
      break;
      
    case "woodcut":
      // Increase contrast for bolder lines
      pipeline = pipeline.linear(1.2, -30);
      break;
      
    case "crosshatch":
      // Sharpen to preserve fine lines
      pipeline = pipeline.sharpen({ sigma: 1.0 });
      break;
      
    case "ink":
      // Slight blur for brush effect
      pipeline = pipeline.blur(0.3);
      break;
      
    case "engraving":
      // Sharpen for fine detail
      pipeline = pipeline.sharpen({ sigma: 0.8 });
      break;
  }
  
  return pipeline.png().toBuffer();
}
