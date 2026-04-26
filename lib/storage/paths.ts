import fs from "fs";
import os from "os";
import path from "path";

function xdgStateRoot(): string {
  const base = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(base, "control-deck");
}

/**
 * Runtime data root for server-side generated state.
 *
 * Dev checkouts keep using ./data when present. Packaged Electron passes
 * CONTROL_DECK_USER_DATA so generated files never land in app resources.
 */
export function dataRoot(): string {
  if (process.env.CONTROL_DECK_DATA_DIR) {
    return path.resolve(process.env.CONTROL_DECK_DATA_DIR);
  }

  if (process.env.CONTROL_DECK_USER_DATA) {
    return path.join(process.env.CONTROL_DECK_USER_DATA, "data");
  }

  const cwdData = path.join(process.cwd(), "data");
  if (fs.existsSync(cwdData)) {
    return cwdData;
  }

  return path.join(xdgStateRoot(), "data");
}

export function artifactRoot(): string {
  return path.resolve(process.env.ARTIFACTS_DIR ?? path.join(dataRoot(), "artifacts"));
}

function assertPlainSegment(value: string, label: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    path.isAbsolute(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function safeArtifactFilename(input: string, fallback = "artifact"): string {
  const base = path.basename(input).replace(/[\x00-\x1f\x7f"<>|:*?]/g, "_").trim();
  const filename = base.length > 0 && base !== "." && base !== ".." ? base : fallback;
  return filename.slice(0, 180);
}

export function artifactRunDir(runId: string): string {
  const root = artifactRoot();
  const run = assertPlainSegment(runId, "artifact run id");
  return path.join(root, run);
}

export function artifactFilePath(runId: string, filename: string): { filename: string; filePath: string } {
  const safeName = safeArtifactFilename(filename);
  return {
    filename: safeName,
    filePath: path.join(artifactRunDir(runId), safeName),
  };
}

export function artifactUrl(runId: string, filename: string): string {
  assertPlainSegment(runId, "artifact run id");
  const safeName = safeArtifactFilename(filename);
  return `/api/artifacts/${encodeURIComponent(runId)}/${encodeURIComponent(safeName)}`;
}

export function resolveArtifactRequestPath(runId: string, filename: string): string | null {
  try {
    const root = artifactRoot();
    const run = assertPlainSegment(runId, "artifact run id");
    const rawName = assertPlainSegment(filename, "artifact filename");
    const name = assertPlainSegment(safeArtifactFilename(rawName), "artifact filename");
    const filePath = path.resolve(root, run, name);
    const runDir = path.resolve(root, run);
    if (filePath !== runDir && filePath.startsWith(runDir + path.sep)) {
      return filePath;
    }
    return null;
  } catch {
    return null;
  }
}
