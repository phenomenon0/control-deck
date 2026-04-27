import { describe, expect, test } from "bun:test";
import { isSameOrigin, denyIfCrossOrigin } from "./originGuard";

describe("isSameOrigin", () => {
  test("permits requests with no Origin header (server-to-server)", () => {
    expect(isSameOrigin(new Request("http://127.0.0.1:3333/api/tools/bridge"))).toBe(true);
  });

  test("permits same-origin browser request", () => {
    const req = new Request("http://127.0.0.1:3333/api/tools/bridge", {
      headers: { Origin: "http://127.0.0.1:3333" },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  test("treats 127.0.0.1 and localhost as same host", () => {
    const req = new Request("http://localhost:3333/api/tools/bridge", {
      headers: { Origin: "http://127.0.0.1:3333" },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  test("rejects cross-origin browser request", () => {
    const req = new Request("http://127.0.0.1:3333/api/tools/bridge", {
      headers: { Origin: "https://attacker.example" },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  test("rejects loopback origin on a different port", () => {
    const req = new Request("http://127.0.0.1:3333/api/tools/bridge", {
      headers: { Origin: "http://127.0.0.1:8080" },
    });
    expect(isSameOrigin(req)).toBe(false);
  });
});

describe("denyIfCrossOrigin", () => {
  test("returns null on same origin", () => {
    const req = new Request("http://127.0.0.1:3333/api/tools/bridge");
    expect(denyIfCrossOrigin(req)).toBeNull();
  });

  test("returns 403 on cross-origin", async () => {
    const req = new Request("http://127.0.0.1:3333/api/tools/bridge", {
      headers: { Origin: "https://attacker.example" },
    });
    const res = denyIfCrossOrigin(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
