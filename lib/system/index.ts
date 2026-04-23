/**
 * System Module Exports
 */

export {
  detectSystem,
  isLiteMode as detectLiteMode,
  getRecommendedTextModel,
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
  getImageResolution,
} from "./profile";
