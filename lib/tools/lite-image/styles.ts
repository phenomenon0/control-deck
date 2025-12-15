/**
 * Lite Image Styles - B&W ink/engraving style definitions
 * Each style has a prompt template and post-processing settings
 */

export type LiteImageStyle = 
  | "stipple" 
  | "woodcut" 
  | "crosshatch" 
  | "ink" 
  | "engraving";

export interface StyleConfig {
  name: string;
  description: string;
  promptPrefix: string;
  promptSuffix: string;
  postProcess: {
    contrast: number;    // Multiplier (1.0 = no change, 1.5 = 50% more contrast)
    threshold: number;   // 0-255, pixels below become black, above become white
    blur?: number;       // Optional pre-threshold blur for smoother edges
  };
}

/**
 * Style configurations for different ink/engraving aesthetics
 * Optimized for 256x256 B&W output
 */
export const STYLES: Record<LiteImageStyle, StyleConfig> = {
  stipple: {
    name: "Stipple",
    description: "Pointillism style with dots creating tonal values, like newspaper prints",
    promptPrefix: "stippled ink drawing, pointillism style,",
    promptSuffix: ", black dots on white paper, high contrast, detailed stippling, artistic illustration",
    postProcess: {
      contrast: 1.4,
      threshold: 128,
      blur: 0.5,
    },
  },

  woodcut: {
    name: "Woodcut",
    description: "Bold carved lines like traditional woodblock prints, high contrast",
    promptPrefix: "woodcut print, linocut style,",
    promptSuffix: ", bold carved lines, high contrast black and white, relief print, dramatic shadows",
    postProcess: {
      contrast: 1.6,
      threshold: 120,
    },
  },

  crosshatch: {
    name: "Crosshatch",
    description: "Fine intersecting lines for shading, like pen and ink drawings",
    promptPrefix: "crosshatched pen and ink drawing,",
    promptSuffix: ", fine detailed lines, engraving style, hatching technique, black ink on white paper",
    postProcess: {
      contrast: 1.3,
      threshold: 135,
      blur: 0.3,
    },
  },

  ink: {
    name: "Ink",
    description: "Brush stroke style like Japanese ink paintings or book illustrations",
    promptPrefix: "black ink brush illustration,",
    promptSuffix: ", vintage book art, high contrast, expressive brushwork, monochrome",
    postProcess: {
      contrast: 1.5,
      threshold: 125,
    },
  },

  engraving: {
    name: "Engraving",
    description: "Fine detailed lines like Victorian steel engravings or currency art",
    promptPrefix: "steel engraving, etching style,",
    promptSuffix: ", victorian illustration, fine detailed parallel lines, copper plate print, antique book illustration",
    postProcess: {
      contrast: 1.4,
      threshold: 130,
      blur: 0.2,
    },
  },
};

/**
 * Default style if none specified
 */
export const DEFAULT_STYLE: LiteImageStyle = "ink";

/**
 * Build the full prompt for a style
 */
export function buildStyledPrompt(
  subject: string,
  style: LiteImageStyle = DEFAULT_STYLE
): string {
  const config = STYLES[style];
  return `${config.promptPrefix} ${subject} ${config.promptSuffix}`;
}

/**
 * Get style config by name
 */
export function getStyleConfig(style: LiteImageStyle): StyleConfig {
  return STYLES[style];
}

/**
 * Get all available style names
 */
export function getStyleNames(): LiteImageStyle[] {
  return Object.keys(STYLES) as LiteImageStyle[];
}

/**
 * Validate if a string is a valid style name
 */
export function isValidStyle(style: string): style is LiteImageStyle {
  return style in STYLES;
}
