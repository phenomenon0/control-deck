import { describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { executeTool } from "./executor";

const ctx = { runId: "test-run", threadId: "test-thread", toolCallId: "test-call" };

describe("read_local_file", () => {
  test("reads a known file by absolute path", async () => {
    const tmp = path.join(os.tmpdir(), `deck-read-test-${Date.now()}.txt`);
    await fs.writeFile(tmp, "hello deck\n", "utf8");
    try {
      const result = await executeTool(
        { name: "read_local_file", args: { path: tmp, maxBytes: 1024, encoding: "utf8" } },
        ctx,
      );
      expect(result.success).toBe(true);
      const data = result.data as { content: string; bytes: number; truncated: boolean };
      expect(data.content).toBe("hello deck\n");
      expect(data.bytes).toBe(11);
      expect(data.truncated).toBe(false);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });

  test("truncates when file exceeds maxBytes", async () => {
    const tmp = path.join(os.tmpdir(), `deck-read-trunc-${Date.now()}.txt`);
    await fs.writeFile(tmp, "x".repeat(500), "utf8");
    try {
      const result = await executeTool(
        { name: "read_local_file", args: { path: tmp, maxBytes: 100, encoding: "utf8" } },
        ctx,
      );
      expect(result.success).toBe(true);
      const data = result.data as { content: string; bytes: number; truncated: boolean; totalBytes: number };
      expect(data.bytes).toBe(100);
      expect(data.truncated).toBe(true);
      expect(data.totalBytes).toBe(500);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });

  test("refuses relative paths", async () => {
    const result = await executeTool(
      { name: "read_local_file", args: { path: "relative/path.txt", maxBytes: 1024, encoding: "utf8" } },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("RELATIVE_PATH");
  });

  test("typed error for missing file", async () => {
    const result = await executeTool(
      {
        name: "read_local_file",
        args: { path: "/this/path/should/not/exist/xyz123", maxBytes: 1024, encoding: "utf8" },
      },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("STAT_FAILED");
  });
});

describe("git tool", () => {
  test("git status succeeds inside a git repo", async () => {
    // The control-deck repo itself is a working tree; cwd is the project.
    const result = await executeTool(
      { name: "git", args: { subcommand: "status", args: ["--porcelain"], timeoutMs: 5000 } },
      ctx,
    );
    expect(result.success).toBe(true);
    const data = result.data as { exitCode: number; stdout: string };
    expect(data.exitCode).toBe(0);
    expect(typeof data.stdout).toBe("string");
  });

  test("git in a non-repo returns NOT_A_REPO", async () => {
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-no-repo-"));
    try {
      const result = await executeTool(
        { name: "git", args: { subcommand: "status", args: [], cwd: tmpdir, timeoutMs: 5000 } },
        ctx,
      );
      expect(result.success).toBe(false);
      expect(result.error_code).toBe("NOT_A_REPO");
    } finally {
      await fs.rmdir(tmpdir).catch(() => {});
    }
  });
});

describe("apply_patch", () => {
  test("refuses binary hunks unless allowBinary is true", async () => {
    const result = await executeTool(
      {
        name: "apply_patch",
        args: {
          diff: "diff --git a/foo b/foo\nGIT binary patch\nliteral 0\nHcmV?d00001\n",
          check: true,
          allowBinary: false,
        },
      },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("BINARY_REFUSED");
  });

  test("check mode validates without modifying", async () => {
    // Create a tmp git repo + file, build a unified diff that would touch it.
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-patch-test-"));
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execFile);
      await exec("git", ["init", "-q"], { cwd: tmpdir });
      await exec("git", ["config", "user.email", "t@t"], { cwd: tmpdir });
      await exec("git", ["config", "user.name", "t"], { cwd: tmpdir });
      await fs.writeFile(path.join(tmpdir, "a.txt"), "one\ntwo\nthree\n");
      await exec("git", ["add", "."], { cwd: tmpdir });
      await exec("git", ["commit", "-q", "-m", "init"], { cwd: tmpdir });

      const diff = [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        " three",
        "",
      ].join("\n");

      const result = await executeTool(
        { name: "apply_patch", args: { diff, cwd: tmpdir, check: true, allowBinary: false } },
        ctx,
      );
      expect(result.success).toBe(true);
      const data = result.data as { filesChanged: string[]; plus: number; minus: number };
      expect(data.filesChanged).toEqual(["a.txt"]);
      expect(data.plus).toBe(1);
      expect(data.minus).toBe(1);

      // File should still have the original content (check mode = no write).
      const after = await fs.readFile(path.join(tmpdir, "a.txt"), "utf8");
      expect(after).toBe("one\ntwo\nthree\n");
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
