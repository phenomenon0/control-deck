// Structural tests for the OSWorld-style bench substrate.
// Guarantees the task specs keep the shape the runner + future agent
// loop depend on, without actually driving any app.

import { describe, expect, test } from "bun:test";
import { tasks } from "./bench.mjs";

describe("bench task registry", () => {
  test("has the seven A-G tasks", () => {
    expect(tasks.map((t) => t.id)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  test("every task has a title; static goals present, or dynamic via setup", () => {
    for (const t of tasks) {
      expect(typeof t.title).toBe("string");
      expect(t.title.length).toBeGreaterThan(0);
      // Task E's goal is constructed at setup time (includes a fresh token).
      // All others have a static goal or an explanatory note.
      if (t.id === "E") {
        expect(typeof t.setup).toBe("function");
      } else {
        expect(t.goal || t.note).toBeTruthy();
      }
    }
  });

  test("every task exposes verify() as a function", () => {
    for (const t of tasks) {
      expect(typeof t.verify).toBe("function");
    }
  });
});

describe("bench verifiers — failure signals without setup", () => {
  test("B (calc) without agentReport reports missing-report reason", async () => {
    const t = tasks.find((x) => x.id === "B");
    const result = await t.verify.call(t, {});
    expect(result.passed).toBe(false);
    expect(result.detail.reason).toMatch(/agentReport/);
  });

  test("D (downloads) without agentReport reports missing-report reason", async () => {
    const t = tasks.find((x) => x.id === "D");
    const result = await t.verify.call(t, {});
    expect(result.passed).toBe(false);
    expect(result.detail.reason).toMatch(/agentReport/);
  });

  test("F (edge h1) rejects non-string report", async () => {
    const t = tasks.find((x) => x.id === "F");
    const result = await t.verify.call(t, { agentReport: 42 });
    expect(result.passed).toBe(false);
  });

  test("F (edge h1) accepts correct report", async () => {
    const t = tasks.find((x) => x.id === "F");
    const result = await t.verify.call(t, { agentReport: "Example Domain" });
    expect(result.passed).toBe(true);
  });

  test("F tolerates surrounding whitespace in the report", async () => {
    const t = tasks.find((x) => x.id === "F");
    const result = await t.verify.call(t, { agentReport: "  Example Domain  " });
    expect(result.passed).toBe(true);
  });

  test("B accepts value within tolerance, rejects outside", async () => {
    const t = tasks.find((x) => x.id === "B");
    const r1 = await t.verify.call(t, { agentReport: 0.5 });
    expect(r1.passed).toBe(true);
    const r2 = await t.verify.call(t, { agentReport: 0.499 });
    expect(r2.passed).toBe(true); // within 0.01
    const r3 = await t.verify.call(t, { agentReport: 0.4 });
    expect(r3.passed).toBe(false);
  });
});

describe("bench E (notepad) — setup-then-verify lifecycle", () => {
  test("verify without setup yields actionable error", async () => {
    const t = tasks.find((x) => x.id === "E");
    // Strip any leftover state from a previous test run
    delete t.__token;
    delete t.__path;
    const result = await t.verify.call(t, {});
    expect(result.passed).toBe(false);
    expect(result.detail.reason).toMatch(/setup/i);
  });

  test("setup produces token + path, goal string is set", async () => {
    const t = tasks.find((x) => x.id === "E");
    const s = await t.setup.call(t);
    expect(typeof s.token).toBe("string");
    expect(s.token.startsWith("bench-")).toBe(true);
    expect(typeof s.path).toBe("string");
    expect(t.goal).toContain(s.token);
    expect(t.goal).toContain(s.path);
    await t.teardown?.call(t);
  });
});
