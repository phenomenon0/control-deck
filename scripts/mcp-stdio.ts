/**
 * MCP stdio entry point.
 *
 * External agent runtimes (Claude Code, Cursor, Zed, etc.) can spawn this as
 * a subprocess in their MCP config, e.g.:
 *
 *   { "mcpServers": { "deck": {
 *       "command": "bun",
 *       "args": ["run", "scripts/mcp-stdio.ts"],
 *       "cwd": "/path/to/control-deck",
 *       "env": { "DECK_TOKEN": "..." }
 *   }}}
 *
 * DECK_TOKEN isn't checked here — stdio is already an authenticated channel
 * (the external agent spawned us as a child process). The server inherits
 * the approval gate via bridgeDispatch, so side-effectful tools still prompt
 * for approval in the Control Deck UI.
 *
 * Keep this script silent on stdout — the MCP transport owns stdout. All
 * logging goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDeckMcpServer } from "../lib/mcp/server";

async function main() {
  const server = createDeckMcpServer({
    name: "control-deck",
    threadIdForSession: `mcp:stdio:${process.pid}`,
    bridgeUrl: process.env.CONTROL_DECK_TOOL_BRIDGE_URL ?? "http://localhost:3333/api/tools/bridge",
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-stdio] Control Deck MCP server ready");
}

main().catch((err) => {
  console.error("[mcp-stdio] fatal:", err);
  process.exit(1);
});
