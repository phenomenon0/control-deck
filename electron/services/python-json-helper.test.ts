import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extractFirstJsonLine, runPythonJsonHelper } from "./python-json-helper";

describe("extractFirstJsonLine — pure parsing", () => {
  test("returns the line when stdout is a single JSON object", () => {
    expect(extractFirstJsonLine('{"ok":true}')).toBe('{"ok":true}');
  });

  test("skips leading log lines and picks the first { line", () => {
    const stdout = 'starting helper\n[info] loading modules\n{"ok":true,"path":"/tmp/x"}\n';
    expect(extractFirstJsonLine(stdout)).toBe('{"ok":true,"path":"/tmp/x"}');
  });

  test("trims leading whitespace on the candidate line", () => {
    expect(extractFirstJsonLine('   {"ok":true}   ')).toBe('{"ok":true}');
  });

  test("returns first JSON line, not the last, when multiple are present", () => {
    const stdout = '{"ok":true,"first":1}\n{"ok":false,"second":2}\n';
    expect(extractFirstJsonLine(stdout)).toBe('{"ok":true,"first":1}');
  });

  test("handles CRLF line endings", () => {
    expect(extractFirstJsonLine('log\r\n{"ok":true}\r\n')).toBe('{"ok":true}');
  });

  test("returns null when no line starts with {", () => {
    expect(extractFirstJsonLine("no json here\njust text\n")).toBeNull();
  });

  test("returns null on empty stdout", () => {
    expect(extractFirstJsonLine("")).toBeNull();
  });

  test("does not misidentify arrays as objects", () => {
    expect(extractFirstJsonLine('["not","an","object"]')).toBeNull();
  });

  test("ignores lines that contain { but do not start with it", () => {
    expect(extractFirstJsonLine('some text { not json\n')).toBeNull();
  });
});

describe("runPythonJsonHelper — integration with stub Python scripts", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdtest-helper-"));
  });
  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  function writeStub(name: string, body: string): string {
    const stubPath = path.join(tmpDir, name);
    fs.writeFileSync(stubPath, body, { mode: 0o755 });
    return stubPath;
  }

  test("parses happy-path JSON from stdout", async () => {
    const stub = writeStub(
      "happy.py",
      `import json, sys
print(json.dumps({"ok": True, "path": sys.argv[1], "width": 10, "height": 20}))
`,
    );
    const result = await runPythonJsonHelper<{
      ok: boolean;
      path: string;
      width: number;
      height: number;
    }>(stub, ["/tmp/out.png"], { timeoutMs: 5000, label: "test" });
    expect(result).toEqual({ ok: true, path: "/tmp/out.png", width: 10, height: 20 });
  });

  test("parses structured failure JSON without throwing", async () => {
    const stub = writeStub(
      "fail.py",
      `import json
print(json.dumps({"ok": False, "error": "user cancelled"}))
`,
    );
    const result = await runPythonJsonHelper<{ ok: boolean; error: string }>(stub, [], {
      timeoutMs: 5000,
      label: "test",
    });
    expect(result).toEqual({ ok: false, error: "user cancelled" });
  });

  test("tolerates log lines preceding the JSON result", async () => {
    const stub = writeStub(
      "noisy.py",
      `import json, sys
print("loading module...", file=sys.stderr)
print("[info] doing work")
print(json.dumps({"ok": True, "path": "/x", "width": 1, "height": 1}))
`,
    );
    const result = await runPythonJsonHelper<{ ok: boolean; path: string }>(stub, [], {
      timeoutMs: 5000,
      label: "test",
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBe("/x");
  });

  test("rejects with helpful message when stdout has no JSON line", async () => {
    const stub = writeStub(
      "nojson.py",
      `import sys
print("crashed before producing output", file=sys.stderr)
sys.exit(3)
`,
    );
    await expect(
      runPythonJsonHelper(stub, [], { timeoutMs: 5000, label: "screenshot" }),
    ).rejects.toThrow(/screenshot helper produced no JSON \(exit=3\).*crashed before producing output/);
  });

  test("rejects when the JSON line is syntactically invalid", async () => {
    const stub = writeStub(
      "badjson.py",
      `print('{not valid json')
`,
    );
    await expect(
      runPythonJsonHelper(stub, [], { timeoutMs: 5000, label: "screencast" }),
    ).rejects.toThrow(/screencast helper returned invalid JSON/);
  });

  test("rejects with timeout error when helper hangs past the deadline", async () => {
    const stub = writeStub(
      "hang.py",
      `import time
time.sleep(10)
print('{"ok": true}')
`,
    );
    const start = Date.now();
    await expect(
      runPythonJsonHelper(stub, [], { timeoutMs: 200, label: "screenshot" }),
    ).rejects.toThrow(/screenshot helper timed out/);
    // Confirm we actually killed it (not just waited for natural exit) by
    // bounding the wall-clock — 200ms deadline + generous slack.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test("rejects via proc error event when command binary is missing", async () => {
    await expect(
      runPythonJsonHelper("/no/such/script.py", [], {
        timeoutMs: 1000,
        label: "test",
        command: "/no/such/binary/anywhere",
      }),
    ).rejects.toThrow();
  });
});
