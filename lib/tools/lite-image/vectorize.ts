/**
 * PNG to SVG Vectorization
 * Converts B&W bitmap images to scalable vector graphics
 */

import sharp from "sharp";

/**
 * Simple potrace-inspired vectorization for B&W images
 * Creates SVG paths from bitmap data
 */
export async function pngToSvg(
  pngBuffer: Buffer,
  options: {
    threshold?: number;
    turnPolicy?: "black" | "white" | "minority" | "majority";
    turdSize?: number;  // Minimum path area (removes noise)
    optTolerance?: number;  // Curve optimization tolerance
  } = {}
): Promise<string> {
  const {
    threshold = 128,
    turdSize = 2,
    optTolerance = 0.2,
  } = options;

  // Get image metadata and raw pixels
  const image = sharp(pngBuffer);
  const metadata = await image.metadata();
  const { width = 256, height = 256 } = metadata;

  // Convert to 1-bit bitmap
  const { data } = await image
    .grayscale()
    .threshold(threshold)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Create binary grid (true = black, false = white)
  const grid: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = data[y * width + x] === 0; // 0 = black after threshold
    }
  }

  // Find contours using simple edge detection
  const paths = findContours(grid, width, height, turdSize);

  // Simplify paths
  const simplifiedPaths = paths.map(path => simplifyPath(path, optTolerance));

  // Generate SVG
  return generateSvg(simplifiedPaths, width, height);
}

/**
 * Find contours in binary image using marching squares
 */
function findContours(
  grid: boolean[][],
  width: number,
  height: number,
  minSize: number
): Array<Array<[number, number]>> {
  const visited = new Set<string>();
  const paths: Array<Array<[number, number]>> = [];

  // Scan for edge pixels
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x] && !visited.has(`${x},${y}`)) {
        // Check if this is an edge pixel (has white neighbor)
        const isEdge = !grid[y - 1][x] || !grid[y + 1][x] || 
                      !grid[y][x - 1] || !grid[y][x + 1];
        
        if (isEdge) {
          const path = traceContour(grid, x, y, width, height, visited);
          if (path.length >= minSize * 4) { // Minimum perimeter
            paths.push(path);
          }
        }
      }
    }
  }

  return paths;
}

/**
 * Trace a single contour starting from a point
 */
function traceContour(
  grid: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
  visited: Set<string>
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  const directions = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1]
  ];

  let x = startX;
  let y = startY;
  let dir = 0;

  const maxSteps = width * height;
  let steps = 0;

  do {
    visited.add(`${x},${y}`);
    path.push([x, y]);

    // Find next edge pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const newDir = (dir + i + 5) % 8; // Start looking to the left
      const [dx, dy] = directions[newDir];
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx]) {
        // Check if it's still an edge
        const isEdge = ny === 0 || ny === height - 1 || nx === 0 || nx === width - 1 ||
          !grid[ny - 1][nx] || !grid[ny + 1][nx] || !grid[ny][nx - 1] || !grid[ny][nx + 1];
        
        if (isEdge && !visited.has(`${nx},${ny}`)) {
          x = nx;
          y = ny;
          dir = newDir;
          found = true;
          break;
        }
      }
    }

    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);

  return path;
}

/**
 * Simplify path using Ramer-Douglas-Peucker algorithm
 */
function simplifyPath(
  path: Array<[number, number]>,
  tolerance: number
): Array<[number, number]> {
  if (path.length <= 2) return path;

  // Find point with max distance from line between first and last
  const first = path[0];
  const last = path[path.length - 1];
  
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < path.length - 1; i++) {
    const dist = pointToLineDistance(path[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(path.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPath(path.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  // Otherwise, return just endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function pointToLineDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx: number, yy: number;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate SVG from paths
 */
function generateSvg(
  paths: Array<Array<[number, number]>>,
  width: number,
  height: number
): string {
  const pathStrings = paths.map(path => {
    if (path.length < 2) return "";
    
    let d = `M ${path[0][0]} ${path[0][1]}`;
    for (let i = 1; i < path.length; i++) {
      d += ` L ${path[i][0]} ${path[i][1]}`;
    }
    d += " Z";
    return d;
  }).filter(d => d.length > 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  ${pathStrings.map(d => `  <path d="${d}" fill="black" stroke="none"/>`).join("\n")}
</svg>`;
}

/**
 * Alternative: Use bitmap directly for simpler SVG
 * Creates a pixel-art style SVG
 */
export async function bitmapToSvg(
  pngBuffer: Buffer,
  options: {
    pixelSize?: number;
    threshold?: number;
  } = {}
): Promise<string> {
  const { pixelSize = 1, threshold = 128 } = options;

  const image = sharp(pngBuffer);
  const metadata = await image.metadata();
  const { width = 256, height = 256 } = metadata;

  const { data } = await image
    .grayscale()
    .threshold(threshold)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build runs of black pixels for efficiency
  const rects: string[] = [];
  
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const isBlack = x < width && data[y * width + x] === 0;
      
      if (isBlack && runStart === -1) {
        runStart = x;
      } else if (!isBlack && runStart !== -1) {
        const runWidth = x - runStart;
        rects.push(
          `<rect x="${runStart * pixelSize}" y="${y * pixelSize}" ` +
          `width="${runWidth * pixelSize}" height="${pixelSize}"/>`
        );
        runStart = -1;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width * pixelSize}" height="${height * pixelSize}" viewBox="0 0 ${width * pixelSize} ${height * pixelSize}">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="black">
    ${rects.join("\n    ")}
  </g>
</svg>`;
}
