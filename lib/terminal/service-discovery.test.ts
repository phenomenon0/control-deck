import { describe, expect, test } from "bun:test";
import { extractEnvValue, parseTerminalServicePid } from "./service-discovery";

describe("parseTerminalServicePid", () => {
  test("extracts the pid for the matching terminal service port from ss output", () => {
    const output = `State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess\nLISTEN 0      511      127.0.0.1:4010      0.0.0.0:*    users:(("node-22",pid=1210146,fd=34))\n`;

    expect(parseTerminalServicePid(output, "4010")).toBe("1210146");
  });

  test("returns null when the requested port is not present", () => {
    const output = `LISTEN 0 511 127.0.0.1:7777 0.0.0.0:* users:(("node",pid=123,fd=3))`;

    expect(parseTerminalServicePid(output, "4010")).toBeNull();
  });
});

describe("extractEnvValue", () => {
  test("reads a single value from a nul-delimited environ blob", () => {
    const environ = `FOO=bar\0TERMINAL_SERVICE_TOKEN=abc123\0BAZ=qux\0`;

    expect(extractEnvValue(environ, "TERMINAL_SERVICE_TOKEN")).toBe("abc123");
  });

  test("returns null for missing keys", () => {
    const environ = `FOO=bar\0BAZ=qux\0`;

    expect(extractEnvValue(environ, "TERMINAL_SERVICE_TOKEN")).toBeNull();
  });
});
