/**
 * /api/fleet/action guards. Every case here is rejected BEFORE nodectl is
 * consulted, so the tests need no fleet, no CLI and no mocks — which is the
 * point: these are the checks that stand between a browser tab and hardware.
 */

import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://127.0.0.1:3333/api/fleet/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fleet/action", () => {
  test("denies a cross-origin request before reading the body", async () => {
    const res = await POST(
      post({ action: "macro.run", params: { name: "blank" } }, { origin: "http://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects a null brightness level instead of coercing it to 0", async () => {
    const res = await POST(post({ action: "display.brightness", params: { level: null } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("level");
  });

  test("rejects non-number tap coordinates ([] and true coerce to 0 and 1)", async () => {
    const res = await POST(post({ action: "wall.tap", params: { gx: [], gy: true } }));
    expect(res.status).toBe(400);
  });

  test("rejects an action outside the allowlist", async () => {
    const res = await POST(post({ action: "system.reboot" }));
    expect(res.status).toBe(400);
  });
});
