/**
 * Procedural Glyph/Motif Generator
 * Generates deterministic SVG sigils, runes, and symbolic patterns from text prompts.
 * No GPU required - instant generation for "broke-tier" image creation.
 */

export type GlyphStyle = "sigil" | "rune" | "mandala" | "circuit" | "organic";

export interface GlyphParams {
  prompt: string;
  style?: GlyphStyle;
  size?: number;
  seed?: number;
}

export interface GlyphResult {
  svg: string;
  seed: number;
  style: GlyphStyle;
}

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // Ensure unsigned
}

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Xorshift32 PRNG
  next(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed % 1000000) / 1000000;
  }

  // Random in range [min, max]
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Random integer in range [min, max]
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  // Random boolean with probability
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  // Pick random item from array
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

const PALETTES: Record<GlyphStyle, { bg: string; stroke: string; fill: string }> = {
  sigil: { bg: "#0f0f0f", stroke: "#d4d4d4", fill: "none" },
  rune: { bg: "#1a1612", stroke: "#c9b896", fill: "none" },
  mandala: { bg: "#0d0d1a", stroke: "#8b7ec8", fill: "none" },
  circuit: { bg: "#0a1210", stroke: "#22c55e", fill: "#22c55e" },
  organic: { bg: "#12100d", stroke: "#a8845c", fill: "none" },
};

/**
 * Sigil: Symmetric angular patterns with crossing lines
 */
function generateSigil(rng: SeededRandom, size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const paths: string[] = [];
  
  // Central circle
  const innerR = size * 0.08;
  paths.push(`<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="currentColor" opacity="0.3"/>`);
  
  // Radial lines from center
  const numLines = rng.int(4, 8);
  const angleStep = Math.PI / numLines;
  
  for (let i = 0; i < numLines * 2; i++) {
    const angle = i * angleStep + rng.range(-0.1, 0.1);
    const length = rng.range(size * 0.2, size * 0.4);
    const x2 = cx + Math.cos(angle) * length;
    const y2 = cy + Math.sin(angle) * length;
    paths.push(`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"/>`);
    
    // Add terminal marks
    if (rng.bool(0.6)) {
      const markSize = rng.range(size * 0.02, size * 0.05);
      paths.push(`<circle cx="${x2}" cy="${y2}" r="${markSize}"/>`);
    }
  }
  
  // Connecting arcs
  const numArcs = rng.int(2, 4);
  for (let i = 0; i < numArcs; i++) {
    const r = rng.range(size * 0.15, size * 0.35);
    const startAngle = rng.range(0, Math.PI * 2);
    const sweep = rng.range(Math.PI * 0.3, Math.PI * 1.2);
    
    const x1 = cx + Math.cos(startAngle) * r;
    const y1 = cy + Math.sin(startAngle) * r;
    const x2 = cx + Math.cos(startAngle + sweep) * r;
    const y2 = cy + Math.sin(startAngle + sweep) * r;
    
    paths.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}" fill="none"/>`);
  }
  
  // Outer boundary (sometimes)
  if (rng.bool(0.5)) {
    const outerR = size * 0.42;
    paths.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke-dasharray="${rng.int(4, 12)} ${rng.int(2, 6)}"/>`);
  }
  
  return paths.join("\n  ");
}

/**
 * Rune: Vertical strokes with horizontal crossbars (Nordic inspired)
 */
function generateRune(rng: SeededRandom, size: number): string {
  const cx = size / 2;
  const paths: string[] = [];
  const margin = size * 0.15;
  const runeHeight = size - margin * 2;
  const runeWidth = size * 0.5;
  
  // Main vertical stroke
  const mainX = cx;
  paths.push(`<line x1="${mainX}" y1="${margin}" x2="${mainX}" y2="${size - margin}" stroke-width="3"/>`);
  
  // Side strokes
  const numSideStrokes = rng.int(1, 3);
  for (let i = 0; i < numSideStrokes; i++) {
    const y = margin + rng.range(runeHeight * 0.1, runeHeight * 0.9);
    const dir = rng.bool() ? 1 : -1;
    const length = rng.range(runeWidth * 0.3, runeWidth * 0.8);
    const angle = rng.range(-0.4, 0.4);
    
    const x2 = mainX + dir * length;
    const y2 = y + Math.tan(angle) * length * dir;
    
    paths.push(`<line x1="${mainX}" y1="${y}" x2="${x2}" y2="${y2}" stroke-width="2"/>`);
    
    // Branch
    if (rng.bool(0.4)) {
      const branchLength = length * 0.5;
      const branchAngle = angle + rng.range(0.3, 0.8) * dir;
      const bx2 = x2 + Math.cos(branchAngle) * branchLength * dir;
      const by2 = y2 + Math.sin(branchAngle) * branchLength;
      paths.push(`<line x1="${x2}" y1="${y2}" x2="${bx2}" y2="${by2}" stroke-width="1.5"/>`);
    }
  }
  
  // Crossbars
  const numCrossbars = rng.int(1, 2);
  for (let i = 0; i < numCrossbars; i++) {
    const y = margin + rng.range(runeHeight * 0.2, runeHeight * 0.8);
    const halfWidth = rng.range(runeWidth * 0.2, runeWidth * 0.5);
    paths.push(`<line x1="${mainX - halfWidth}" y1="${y}" x2="${mainX + halfWidth}" y2="${y}" stroke-width="2"/>`);
  }
  
  // Terminal marks
  paths.push(`<circle cx="${mainX}" cy="${margin}" r="${size * 0.02}" fill="currentColor"/>`);
  paths.push(`<circle cx="${mainX}" cy="${size - margin}" r="${size * 0.02}" fill="currentColor"/>`);
  
  return paths.join("\n  ");
}

/**
 * Mandala: Radial circular patterns with symmetry
 */
function generateMandala(rng: SeededRandom, size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const paths: string[] = [];
  
  // Concentric rings
  const numRings = rng.int(3, 5);
  for (let i = 1; i <= numRings; i++) {
    const r = (size * 0.4 * i) / numRings;
    const dashArray = rng.bool(0.3) ? `stroke-dasharray="${rng.int(2, 8)} ${rng.int(1, 4)}"` : "";
    paths.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ${dashArray}/>`);
  }
  
  // Radial petals/segments
  const symmetry = rng.pick([4, 6, 8, 12]);
  const angleStep = (Math.PI * 2) / symmetry;
  
  for (let i = 0; i < symmetry; i++) {
    const angle = i * angleStep;
    
    // Radial line
    const innerR = size * 0.1;
    const outerR = size * 0.4;
    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * outerR;
    const y2 = cy + Math.sin(angle) * outerR;
    paths.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    
    // Petal shape
    if (rng.bool(0.7)) {
      const midR = rng.range(innerR, outerR);
      const bulge = rng.range(size * 0.03, size * 0.08);
      const mx = cx + Math.cos(angle) * midR;
      const my = cy + Math.sin(angle) * midR;
      const perpAngle = angle + Math.PI / 2;
      const bx = mx + Math.cos(perpAngle) * bulge;
      const by = my + Math.sin(perpAngle) * bulge;
      
      paths.push(`<path d="M ${x1} ${y1} Q ${bx} ${by} ${x2} ${y2}" fill="none"/>`);
    }
  }
  
  // Center ornament
  const centerR = size * 0.06;
  paths.push(`<circle cx="${cx}" cy="${cy}" r="${centerR}" fill="currentColor" opacity="0.5"/>`);
  
  // Dots around a ring
  const dotRing = rng.range(size * 0.2, size * 0.35);
  const numDots = symmetry * 2;
  for (let i = 0; i < numDots; i++) {
    const angle = (i * Math.PI * 2) / numDots;
    const dx = cx + Math.cos(angle) * dotRing;
    const dy = cy + Math.sin(angle) * dotRing;
    paths.push(`<circle cx="${dx}" cy="${dy}" r="${size * 0.012}" fill="currentColor"/>`);
  }
  
  return paths.join("\n  ");
}

/**
 * Circuit: Grid-based lines and nodes (digital/tech aesthetic)
 */
function generateCircuit(rng: SeededRandom, size: number): string {
  const paths: string[] = [];
  const gridSize = rng.pick([4, 5, 6]);
  const cellSize = size / gridSize;
  const margin = cellSize * 0.3;
  
  // Grid of potential connection points
  const nodes: Array<{ x: number; y: number; connected: boolean }> = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (rng.bool(0.6)) {
        nodes.push({
          x: margin + col * cellSize + cellSize / 2,
          y: margin + row * cellSize + cellSize / 2,
          connected: false,
        });
      }
    }
  }
  
  // Connect nodes with orthogonal lines
  for (const node of nodes) {
    // Find nearby nodes to connect to
    const nearby = nodes.filter(
      (n) =>
        n !== node &&
        !n.connected &&
        Math.abs(n.x - node.x) + Math.abs(n.y - node.y) < cellSize * 2.5
    );
    
    if (nearby.length > 0 && rng.bool(0.7)) {
      const target = rng.pick(nearby);
      target.connected = true;
      
      // Orthogonal path
      if (rng.bool()) {
        // Horizontal then vertical
        paths.push(`<path d="M ${node.x} ${node.y} L ${target.x} ${node.y} L ${target.x} ${target.y}" fill="none"/>`);
      } else {
        // Vertical then horizontal
        paths.push(`<path d="M ${node.x} ${node.y} L ${node.x} ${target.y} L ${target.x} ${target.y}" fill="none"/>`);
      }
    }
    
    // Node marker
    const nodeSize = rng.range(size * 0.015, size * 0.03);
    if (rng.bool(0.7)) {
      paths.push(`<rect x="${node.x - nodeSize}" y="${node.y - nodeSize}" width="${nodeSize * 2}" height="${nodeSize * 2}" fill="currentColor"/>`);
    } else {
      paths.push(`<circle cx="${node.x}" cy="${node.y}" r="${nodeSize}" fill="currentColor"/>`);
    }
  }
  
  // Random trace lines
  const numTraces = rng.int(2, 5);
  for (let i = 0; i < numTraces; i++) {
    const x1 = rng.range(margin, size - margin);
    const y1 = rng.range(margin, size - margin);
    const x2 = rng.range(margin, size - margin);
    const y2 = rng.range(margin, size - margin);
    
    // Snap to grid-ish
    const midX = rng.bool() ? x1 : x2;
    const midY = rng.bool() ? y2 : y1;
    
    paths.push(`<path d="M ${x1} ${y1} L ${midX} ${midY} L ${x2} ${y2}" fill="none" stroke-dasharray="2 2"/>`);
  }
  
  return paths.join("\n  ");
}

/**
 * Organic: Curved flowing shapes (natural/biological aesthetic)
 */
function generateOrganic(rng: SeededRandom, size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const paths: string[] = [];
  
  // Central blob
  const numPoints = rng.int(5, 8);
  const blobPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i * Math.PI * 2) / numPoints + rng.range(-0.2, 0.2);
    const r = rng.range(size * 0.1, size * 0.2);
    blobPoints.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }
  
  // Draw blob as smooth curve
  let blobPath = `M ${blobPoints[0].x} ${blobPoints[0].y}`;
  for (let i = 0; i < numPoints; i++) {
    const p1 = blobPoints[i];
    const p2 = blobPoints[(i + 1) % numPoints];
    const cpx = (p1.x + p2.x) / 2 + rng.range(-size * 0.05, size * 0.05);
    const cpy = (p1.y + p2.y) / 2 + rng.range(-size * 0.05, size * 0.05);
    blobPath += ` Q ${cpx} ${cpy} ${p2.x} ${p2.y}`;
  }
  blobPath += " Z";
  paths.push(`<path d="${blobPath}" fill="currentColor" opacity="0.15"/>`);
  
  // Tendrils/branches
  const numTendrils = rng.int(4, 7);
  for (let i = 0; i < numTendrils; i++) {
    const startAngle = rng.range(0, Math.PI * 2);
    const startR = rng.range(size * 0.15, size * 0.2);
    const x1 = cx + Math.cos(startAngle) * startR;
    const y1 = cy + Math.sin(startAngle) * startR;
    
    // Bezier curve tendril
    const length = rng.range(size * 0.15, size * 0.3);
    const curl = rng.range(-0.5, 0.5);
    const endAngle = startAngle + rng.range(-0.5, 0.5);
    
    const cp1x = x1 + Math.cos(startAngle + curl) * length * 0.5;
    const cp1y = y1 + Math.sin(startAngle + curl) * length * 0.5;
    const x2 = cx + Math.cos(endAngle) * (startR + length);
    const y2 = cy + Math.sin(endAngle) * (startR + length);
    
    paths.push(`<path d="M ${x1} ${y1} Q ${cp1x} ${cp1y} ${x2} ${y2}" fill="none"/>`);
    
    // Tip
    if (rng.bool(0.6)) {
      paths.push(`<circle cx="${x2}" cy="${y2}" r="${rng.range(size * 0.01, size * 0.025)}" fill="currentColor"/>`);
    }
  }
  
  // Scattered spores/dots
  const numSpores = rng.int(5, 12);
  for (let i = 0; i < numSpores; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(size * 0.25, size * 0.42);
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const sr = rng.range(size * 0.008, size * 0.02);
    paths.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="currentColor" opacity="${rng.range(0.3, 0.8)}"/>`);
  }
  
  return paths.join("\n  ");
}

/**
 * Generate a procedural glyph/motif SVG
 */
export function generateGlyphSvg(params: GlyphParams): GlyphResult {
  const { prompt, style = "sigil", size = 256 } = params;
  
  // Determine seed: use provided seed or hash from prompt
  const seed = params.seed ?? fnv1a(prompt + style);
  const rng = new SeededRandom(seed);
  
  // Get palette for style
  const palette = PALETTES[style];
  
  // Generate style-specific content
  let content: string;
  switch (style) {
    case "sigil":
      content = generateSigil(rng, size);
      break;
    case "rune":
      content = generateRune(rng, size);
      break;
    case "mandala":
      content = generateMandala(rng, size);
      break;
    case "circuit":
      content = generateCircuit(rng, size);
      break;
    case "organic":
      content = generateOrganic(rng, size);
      break;
    default:
      content = generateSigil(rng, size);
  }
  
  // Assemble SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="${palette.bg}"/>
  <g stroke="${palette.stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="${palette.fill}" color="${palette.stroke}">
  ${content}
  </g>
</svg>`;
  
  return { svg, seed, style };
}

/**
 * Generate a 4x4 spritesheet of variations
 */
export function generateGlyphSheet(params: GlyphParams): GlyphResult {
  const { prompt, style = "sigil", size = 512 } = params;
  const baseSeed = params.seed ?? fnv1a(prompt + style);
  
  const cellSize = size / 4;
  const palette = PALETTES[style];
  const cells: string[] = [];
  
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const cellSeed = baseSeed + row * 4 + col;
      const rng = new SeededRandom(cellSeed);
      
      let content: string;
      switch (style) {
        case "sigil":
          content = generateSigil(rng, cellSize);
          break;
        case "rune":
          content = generateRune(rng, cellSize);
          break;
        case "mandala":
          content = generateMandala(rng, cellSize);
          break;
        case "circuit":
          content = generateCircuit(rng, cellSize);
          break;
        case "organic":
          content = generateOrganic(rng, cellSize);
          break;
        default:
          content = generateSigil(rng, cellSize);
      }
      
      const x = col * cellSize;
      const y = row * cellSize;
      cells.push(`<g transform="translate(${x}, ${y})">${content}</g>`);
    }
  }
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="${palette.bg}"/>
  <g stroke="${palette.stroke}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="${palette.fill}" color="${palette.stroke}">
  ${cells.join("\n  ")}
  </g>
</svg>`;
  
  return { svg, seed: baseSeed, style };
}
