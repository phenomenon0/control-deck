import { afterEach, describe, expect, test } from "bun:test";
import { buildToolBridgeUrl } from "./bridge-url";

const originalEnv = {
  DECK_TOKEN: process.env.DECK_TOKEN,
  TOOL_BRIDGE_TOKEN: process.env.TOOL_BRIDGE_TOKEN,
  TOOL_BRIDGE_URL: process.env.TOOL_BRIDGE_URL,
  CONTROL_DECK_TRUST_PROXY_HEADERS: process.env.CONTROL_DECK_TRUST_PROXY_HEADERS,
};

afterEach(() => {
  if (originalEnv.DECK_TOKEN === undefined) delete process.env.DECK_TOKEN;
  else process.env.DECK_TOKEN = originalEnv.DECK_TOKEN;
  if (originalEnv.TOOL_BRIDGE_TOKEN === undefined) delete process.env.TOOL_BRIDGE_TOKEN;
  else process.env.TOOL_BRIDGE_TOKEN = originalEnv.TOOL_BRIDGE_TOKEN;
  if (originalEnv.TOOL_BRIDGE_URL === undefined) delete process.env.TOOL_BRIDGE_URL;
  else process.env.TOOL_BRIDGE_URL = originalEnv.TOOL_BRIDGE_URL;
  if (originalEnv.CONTROL_DECK_TRUST_PROXY_HEADERS === undefined) {
    delete process.env.CONTROL_DECK_TRUST_PROXY_HEADERS;
  } else {
    process.env.CONTROL_DECK_TRUST_PROXY_HEADERS = originalEnv.CONTROL_DECK_TRUST_PROXY_HEADERS;
  }
});

describe("buildToolBridgeUrl", () => {
  test("derives the bridge URL from the request origin", () => {
    delete process.env.DECK_TOKEN;
    delete process.env.TOOL_BRIDGE_TOKEN;
    delete process.env.TOOL_BRIDGE_URL;

    const url = buildToolBridgeUrl(new Request("http://127.0.0.1:4567/api/chat"));

    expect(url).toBe("http://127.0.0.1:4567/api/tools/bridge");
  });

  test("ignores forwarded origin headers by default", () => {
    delete process.env.DECK_TOKEN;
    delete process.env.TOOL_BRIDGE_TOKEN;
    delete process.env.TOOL_BRIDGE_URL;

    const url = buildToolBridgeUrl(
      new Request("http://127.0.0.1:3333/api/chat", {
        headers: {
          "x-forwarded-host": "deck.local:8443",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(url).toBe("http://127.0.0.1:3333/api/tools/bridge");
  });

  test("uses forwarded origin headers only when proxy trust is enabled", () => {
    delete process.env.DECK_TOKEN;
    delete process.env.TOOL_BRIDGE_TOKEN;
    delete process.env.TOOL_BRIDGE_URL;
    process.env.CONTROL_DECK_TRUST_PROXY_HEADERS = "1";

    const url = buildToolBridgeUrl(
      new Request("http://127.0.0.1:3333/api/chat", {
        headers: {
          "x-forwarded-host": "deck.local:8443",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(url).toBe("https://deck.local:8443/api/tools/bridge");
  });

  test("adds a bridge token when using the default route", () => {
    process.env.DECK_TOKEN = "deck-secret";
    delete process.env.TOOL_BRIDGE_TOKEN;
    delete process.env.TOOL_BRIDGE_URL;

    const url = new URL(buildToolBridgeUrl(new Request("http://localhost:3333/api/chat")));

    expect(url.searchParams.get("bridge_token")).toBe("deck-secret");
  });

  test("leaves explicit bridge URLs unchanged", () => {
    process.env.DECK_TOKEN = "deck-secret";
    process.env.TOOL_BRIDGE_URL = "http://agent-bridge.local/callback";

    const url = buildToolBridgeUrl(new Request("http://localhost:3333/api/chat"));

    expect(url).toBe("http://agent-bridge.local/callback");
  });
});
