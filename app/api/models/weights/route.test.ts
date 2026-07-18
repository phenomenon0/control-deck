import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { DELETE, POST } from "./route";

function post(body: unknown, origin?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://127.0.0.1:3333/api/models/weights", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("/api/models/weights request safety", () => {
  test("denies cross-origin download requests before queueing work", async () => {
    const response = await POST(post(
      { preset: "sdxl-turbo" },
      "https://attacker.example",
    ));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross-origin request denied" });
  });

  test.each([
    null,
    {},
    { preset: "sdxl-turbo", files: ["sdxl-turbo-ckpt"] },
    { files: "sdxl-turbo-ckpt" },
    { files: {} },
    { files: [] },
    { extra: true },
  ])("rejects malformed bodies with 400: %p", async (body) => {
    const response = await POST(post(body, "http://localhost:3333"));
    expect(response.status).toBe(400);
  });

  test("rejects unknown presets and file keys without starting a job", async () => {
    const presetResponse = await POST(post({ preset: "not-a-preset" }));
    expect(presetResponse.status).toBe(400);
    expect(await presetResponse.json()).toEqual({ error: "unknown preset" });

    const fileResponse = await POST(post({ files: ["not-a-file"] }));
    expect(fileResponse.status).toBe(400);
    expect(await fileResponse.json()).toEqual({ error: "file list contains an unknown catalog key" });
  });

  test("allows same-origin and server callers through to a validated catalog request", async () => {
    for (const origin of ["http://localhost:3333", undefined]) {
      const response = await POST(post({ files: ["ace-step-ckpt"] }, origin));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { enqueued: unknown[]; skipped: string[] };
      expect(body.enqueued).toEqual([]);
      expect(body.skipped).toEqual(["ace-step-ckpt (no verified source URL)"]);
    }
  });

  test("denies cross-origin cancellation requests", async () => {
    const request = new NextRequest(
      "http://127.0.0.1:3333/api/models/weights?job=dl_test",
      { method: "DELETE", headers: { origin: "https://attacker.example" } },
    );
    const response = await DELETE(request);
    expect(response.status).toBe(403);
  });
});
