/**
 * Workspace jail — every native tool path goes through `resolve()`.
 *
 * Mirrors the safe-path pattern in `lib/storage/paths.ts`: resolve relative
 * paths against the workspace root and reject anything that escapes.
 */

import path from "node:path";

export class WorkspaceJail {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(relative: string): string {
    if (!relative || relative === ".") return this.root;
    if (path.isAbsolute(relative)) {
      const abs = path.resolve(relative);
      this.assertInside(abs);
      return abs;
    }
    const abs = path.resolve(this.root, relative);
    this.assertInside(abs);
    return abs;
  }

  private assertInside(abs: string) {
    const normalizedRoot = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(normalizedRoot)) {
      throw new Error(`Path escapes workspace: ${abs}`);
    }
  }

  /** Convert an absolute path back to a workspace-relative one for display. */
  toRelative(abs: string): string {
    const rel = path.relative(this.root, abs);
    return rel || ".";
  }
}
