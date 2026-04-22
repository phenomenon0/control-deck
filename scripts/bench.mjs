// Native-automation benchmark — a scoring substrate, not a driver.
//
// Each task defines:
//   - `goal`    : natural-language prompt the agent reads
//   - `setup`   : puts the desktop in a known state so `verify` can tell
//   - `verify`  : pure check against external truth (filesystem, math,
//                 pixel, registry) — returns {passed, detail}
//   - `teardown`: optional cleanup after scoring
//
// No hand-authored action sequences. The runner does NOT drive the UI.
// That's the agent's job (through /api/tools/bridge in production).
//
// Modes:
//   bun scripts/bench.mjs list
//   bun scripts/bench.mjs setup <id>
//   bun scripts/bench.mjs verify <id>
//   bun scripts/bench.mjs score              # verify all in sequence
//   bun scripts/bench.mjs prompt <id>        # print the agent prompt
//
// Typical flow:
//   1. bun bench setup A      # prepares desktop, prints the goal
//   2. <you or an agent does the task through the app>
//   3. bun bench verify A     # scores it
//
// Reference benchmarks: OSWorld (Xie et al., 2024), WindowsAgentArena
// (Microsoft, 2024). Both decouple the task definition from the runner
// and score pass/fail on post-conditions — which is what this file is.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TMP = "C:\\Users\\jethr\\tmp";
fs.mkdirSync(TMP, { recursive: true });

// ── verification primitives ───────────────────────────────────────

function assertFileExists(p, { emptyOk = false } = {}) {
  if (!fs.existsSync(p)) return { ok: false, reason: `file missing: ${p}` };
  const stat = fs.statSync(p);
  if (!emptyOk && stat.size === 0) return { ok: false, reason: `file is empty: ${p}` };
  return { ok: true, size: stat.size };
}

function readFileContents(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").replace(/\0/g, "");
}

function regQuery(key) {
  const r = spawnSync("reg", ["query", key], { encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
}

function dirContents(dir, { filesOnly = true, skipHidden = true } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => filesOnly ? d.isFile() : true)
    .filter((d) => !skipHidden || (!d.name.startsWith(".") && d.name !== "desktop.ini"))
    .map((d) => ({
      name: d.name,
      mtime: fs.statSync(path.join(dir, d.name)).mtimeMs,
    }));
}

// ── task specs ────────────────────────────────────────────────────

export const tasks = [
  {
    id: "A",
    title: "Create folder + empty file",
    goal:
      "Create a folder named 'project-alpha' inside C:\\Users\\jethr\\Documents, " +
      "and create an empty file named 'readme.md' inside it.",
    setup() {
      const folder = path.join("C:\\Users\\jethr\\Documents", "project-alpha");
      fs.rmSync(folder, { recursive: true, force: true });
      return { cleaned: true, expectedFolder: folder, expectedFile: path.join(folder, "readme.md") };
    },
    verify() {
      const folder = path.join("C:\\Users\\jethr\\Documents", "project-alpha");
      const file = path.join(folder, "readme.md");
      const folderOk = fs.existsSync(folder) && fs.statSync(folder).isDirectory();
      const fileOk = fs.existsSync(file) && fs.statSync(file).size === 0;
      return {
        passed: folderOk && fileOk,
        detail: { folderOk, fileOk, folder, file },
      };
    },
    teardown() {
      fs.rmSync(path.join("C:\\Users\\jethr\\Documents", "project-alpha"),
        { recursive: true, force: true });
    },
  },

  {
    id: "B",
    title: "Calculator sin(30°)",
    goal:
      "Open Calculator, switch to scientific mode, compute sin(30°) with the " +
      "angle unit set to degrees. The expected value on the display is 0.5.",
    note:
      "Verification is heuristic — there is no durable 'last result' for the " +
      "new UWP Calculator. Verify runs the value through Math.sin and reports " +
      "the expected answer; passing the task requires the agent to self-report " +
      "success. For a stronger signal, the agent should screenshot the display.",
    setup() {
      return { expected: Math.sin(Math.PI / 6) };
    },
    verify({ agentReport } = {}) {
      const expected = Math.sin(Math.PI / 6);
      if (agentReport === undefined) {
        return {
          passed: false,
          detail: {
            expected,
            reason: "Calc has no persistent store for last result — pass the agent's reported display value as `agentReport`.",
          },
        };
      }
      const ok = Math.abs(agentReport - expected) < 0.01;
      return { passed: ok, detail: { expected, agentReport, delta: Math.abs(agentReport - expected) } };
    },
  },

  {
    id: "C",
    title: "Paint red 200x200 PNG",
    goal:
      "Open Paint, resize canvas to 200×200, fill it with red, and save as PNG to " +
      "C:\\Users\\jethr\\tmp\\red.png.",
    note:
      "Verification uses `sharp` to decode the PNG, check dimensions, and sample " +
      "the center pixel. Target: 200×200, RGB near (237,28,36) or any strong red " +
      "(R>180, G<60, B<60). Genuinely hard for a UWP Paint canvas — limitation " +
      "acknowledged.",
    async setup() {
      const outPath = path.join(TMP, "red.png");
      fs.rmSync(outPath, { force: true });
      return { outPath };
    },
    async verify() {
      const outPath = path.join(TMP, "red.png");
      if (!fs.existsSync(outPath)) {
        return { passed: false, detail: { reason: "file not saved", path: outPath } };
      }
      const sharp = (await import("sharp")).default;
      const img = sharp(outPath);
      const meta = await img.metadata();
      const sizeOk = meta.width === 200 && meta.height === 200;
      const { data } = await img.raw().toBuffer({ resolveWithObject: true });
      // Center pixel is at (100, 100); each pixel 3 or 4 bytes.
      const channels = meta.channels ?? 3;
      const offset = (100 * meta.width + 100) * channels;
      const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
      const redOk = r > 180 && g < 60 && b < 60;
      return {
        passed: sizeOk && redOk,
        detail: { sizeOk, redOk, dims: `${meta.width}x${meta.height}`, centerRGB: [r, g, b] },
      };
    },
    teardown() {
      fs.rmSync(path.join(TMP, "red.png"), { force: true });
    },
  },

  {
    id: "D",
    title: "Identify top-3 most-recently-modified files in Downloads",
    goal:
      "Open File Explorer, navigate to C:\\Users\\jethr\\Downloads, sort files by " +
      "Date Modified descending, and report the names of the top 3 most-recently-" +
      "modified files.",
    note:
      "Verify compares the agent's reported names against the filesystem mtime " +
      "sort (skipping hidden/desktop.ini). Passing requires an `agentReport` " +
      "array of 3 names — agent-reported, not read from the UI by the harness.",
    setup() {
      const top3 = dirContents("C:\\Users\\jethr\\Downloads")
        .sort((a, b) => b.mtime - a.mtime).slice(0, 3).map((x) => x.name);
      return { expectedTop3: top3 };
    },
    verify({ agentReport } = {}) {
      const truth = dirContents("C:\\Users\\jethr\\Downloads")
        .sort((a, b) => b.mtime - a.mtime).slice(0, 3).map((x) => x.name);
      if (!Array.isArray(agentReport)) {
        return {
          passed: false,
          detail: { reason: "pass agentReport: string[] of 3 filenames", truth },
        };
      }
      // Match by stem (Explorer hides .exe extensions by default).
      const stem = (s) => s.replace(/\.[^.]+$/, "").toLowerCase();
      const match = truth.length === agentReport.length
        && truth.every((t, i) => stem(t) === stem(agentReport[i]));
      return { passed: match, detail: { truth, agentReport } };
    },
  },

  {
    id: "E",
    title: "Notepad write, save, close, re-read",
    goal: null, // set dynamically via setup so the token isn't hardcoded
    async setup() {
      const token = `bench-${Math.random().toString(36).slice(2, 10)}`;
      const outPath = path.join(TMP, `bench-notepad.txt`);
      fs.rmSync(outPath, { force: true });
      this.goal =
        `Open Notepad, type the exact string "${token}" (with no extra ` +
        `whitespace), save the file as ${outPath}, and close Notepad.`;
      this.__token = token;
      this.__path = outPath;
      return { token, path: outPath };
    },
    verify() {
      if (!this.__token || !this.__path) {
        return { passed: false, detail: { reason: "setup must run before verify" } };
      }
      const contents = readFileContents(this.__path);
      if (contents === null) {
        return { passed: false, detail: { reason: "file does not exist", path: this.__path } };
      }
      // Notepad can save UTF-16 LE with BOM — read bytes too.
      const raw = fs.readFileSync(this.__path);
      const asUtf16 = raw.length > 2 && raw[0] === 0xff && raw[1] === 0xfe
        ? raw.slice(2).swap16().toString("utf16le")
        : null;
      const tokenFound = contents.includes(this.__token) || (asUtf16 && asUtf16.includes(this.__token));
      return {
        passed: tokenFound,
        detail: {
          expected: this.__token,
          fileSize: raw.length,
          startsWith: contents.slice(0, 40),
        },
      };
    },
    teardown() {
      if (this.__path) fs.rmSync(this.__path, { force: true });
    },
  },

  {
    id: "F",
    title: "Edge: read example.com h1",
    goal:
      "Open Microsoft Edge and navigate to https://example.com. Report the " +
      "exact text of the page's top-level heading (the <h1> element).",
    verify({ agentReport } = {}) {
      if (typeof agentReport !== "string") {
        return { passed: false, detail: { reason: "pass agentReport: string — the reported h1 text" } };
      }
      const passed = agentReport.trim() === "Example Domain";
      return {
        passed,
        detail: { expected: "Example Domain", agentReport: agentReport.trim() },
      };
    },
  },

  {
    id: "G",
    title: "Toggle Night Light in Settings",
    goal:
      "Open Windows Settings, navigate to Display → Night light, and toggle " +
      "the Night Light switch (either on → off or off → on).",
    setup() {
      const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\Cache\\DefaultAccount";
      this.__before = regQuery(key);
      return { before: this.__before.length };
    },
    verify() {
      const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\Cache\\DefaultAccount";
      const after = regQuery(key);
      const changed = this.__before && after !== this.__before;
      return {
        passed: !!changed,
        detail: {
          note: "Compares the CloudStore cache dump before and after; any change implies a CloudStore write, which Night-Light toggles produce.",
          beforeLen: this.__before?.length ?? 0,
          afterLen: after.length,
          changed,
        },
      };
    },
  },
];

// ── runner CLI ────────────────────────────────────────────────────
// Only run the CLI when this file is executed directly (not imported
// by tests or by an agent runner). Bun and Node expose `import.meta.main`;
// fall back to an argv[1] check for older runtimes.
const isDirect = typeof import.meta.main === "boolean"
  ? import.meta.main
  : (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (!isDirect) {
  // Imported as a module — expose `tasks` and return.
  // (Nothing else needs to happen at import time.)
} else {

const mode = process.argv[2];
const id = process.argv[3];

async function withTask(id, fn) {
  const task = tasks.find((t) => t.id.toUpperCase() === id?.toUpperCase());
  if (!task) {
    console.error(`unknown task id: ${id}. Available: ${tasks.map((t) => t.id).join(", ")}`);
    process.exit(2);
  }
  return fn(task);
}

async function cmdList() {
  for (const t of tasks) {
    console.log(`${t.id}  ${t.title}`);
  }
}

async function cmdPrompt() {
  await withTask(id, async (t) => {
    if (typeof t.setup === "function") await t.setup.call(t);
    console.log(t.goal);
  });
}

async function cmdSetup() {
  await withTask(id, async (t) => {
    const result = typeof t.setup === "function" ? await t.setup.call(t) : {};
    console.log(`[${t.id}] ${t.title}`);
    console.log(`goal: ${t.goal}`);
    if (Object.keys(result).length) {
      console.log(`setup: ${JSON.stringify(result, null, 2)}`);
    }
    if (t.note) console.log(`note: ${t.note}`);
  });
}

async function cmdVerify() {
  const agentReportRaw = process.argv[4];
  let agentReport;
  if (agentReportRaw !== undefined) {
    try { agentReport = JSON.parse(agentReportRaw); }
    catch { agentReport = agentReportRaw; }
  }
  await withTask(id, async (t) => {
    const result = await t.verify.call(t, { agentReport });
    const mark = result.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`[${t.id}] ${mark}  ${t.title}`);
    console.log(JSON.stringify(result.detail, null, 2));
    process.exit(result.passed ? 0 : 1);
  });
}

async function cmdScore() {
  let passed = 0;
  for (const t of tasks) {
    try {
      const r = await t.verify.call(t, {});
      const mark = r.passed ? "✓" : "✗";
      console.log(`${mark} ${t.id}  ${t.title}`);
      if (!r.passed && r.detail?.reason) console.log(`     reason: ${r.detail.reason}`);
      if (r.passed) passed++;
    } catch (err) {
      console.log(`! ${t.id}  ${t.title}  threw: ${err?.message ?? err}`);
    }
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${passed}/${tasks.length} passed`);
}

switch (mode) {
  case "list": await cmdList(); break;
  case "prompt": await cmdPrompt(); break;
  case "setup": await cmdSetup(); break;
  case "verify": await cmdVerify(); break;
  case "score": await cmdScore(); break;
  default:
    console.log(`usage: bench.mjs <list | prompt <id> | setup <id> | verify <id> [agentReport] | score>`);
    process.exit(1);
}

} // end isDirect
