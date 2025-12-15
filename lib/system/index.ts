/**
 * System Module Exports
 */

export {
  detectSystem,
  isLiteMode as detectLiteMode,
  getRecommendedTextModel,
  getRecommendedImageBackend,
  formatSystemProfile,
  type SystemProfile,
  type DeckMode,
  type GpuInfo,
} from "./detect";

export {
  getSystemProfile,
  refreshSystemProfile,
  isLiteMode,
  isPowerMode,
  getTextModel,
  getImageBackend,
  getImageResolution,
} from "./profile";
