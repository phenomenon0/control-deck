import { describe, expect, test } from "bun:test";
import { GET } from "./route";

function makeReq(qs = ""): Parameters<typeof GET>[0] {
  const url = `http://localhost/api/tools/catalog${qs ? `?${qs}` : ""}`;
  // Cast through unknown — the route only reads `nextUrl.searchParams`.
  return {
    nextUrl: new URL(url),
  } as unknown as Parameters<typeof GET>[0];
}

describe("/api/tools/catalog", () => {
  test("responds with catalogVersion and tools[]", async () => {
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      catalogVersion: string;
      tools: Array<{ name: string; policy: { risk: string } }>;
    };
    expect(typeof body.catalogVersion).toBe("string");
    expect(body.catalogVersion).toMatch(/^[0-9a-f]{8}$/);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });

  test("each tool carries policy fields from the manifest", async () => {
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      tools: Array<{
        name: string;
        policy: {
          risk: string;
          sideEffect: string;
          allowInVoice: boolean;
          allowInMcp: boolean;
          requiresApproval: boolean;
          timeoutMs: number;
        };
      }>;
    };
    const exec = body.tools.find((t) => t.name === "execute_code");
    expect(exec).toBeDefined();
    expect(exec!.policy.risk).toBe("dangerous");
    expect(exec!.policy.allowInVoice).toBe(false);
    expect(exec!.policy.requiresApproval).toBe(true);

    const analyze = body.tools.find((t) => t.name === "analyze_image");
    expect(analyze!.policy.risk).toBe("read_only");
    expect(analyze!.policy.allowInVoice).toBe(true);
  });

  test("?refresh=1 still returns a catalog (cache rebuild path)", async () => {
    const res = await GET(makeReq("refresh=1"));
    const body = (await res.json()) as { tools: unknown[] };
    expect(body.tools.length).toBeGreaterThan(0);
  });
});
