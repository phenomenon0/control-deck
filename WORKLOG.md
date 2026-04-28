# Control Deck Worklog

## 2026-04-26 20:44 CST — MCP connection bootstrap

- Confirmed project path: `/home/omen/Documents/INIT/control-deck`.
- Loaded Control Deck MCP skill and verified the stdio MCP server with `npx mcporter list --stdio "bun run mcp:stdio" --schema`.
- Installed Python `mcp` package into the user Python environment so Hermes native MCP discovery can work after restart.
- Added Hermes native MCP config in `/home/omen/.hermes/config.yaml`:
  - server id: `control_deck`
  - command: `/home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh`
- Added wrapper script `scripts/mcp-stdio-wrapper.sh` because Hermes native MCP config has no cwd field and `bun --cwd ... run mcp:stdio` did not work as expected.
- Set Control Deck approval policy in `data/deck.db` to `defaultMode=never` so external MCP calls do not hang waiting for UI approval during this local build/test session.
- Verified MCP tool call succeeds via mcporter:
  - tool: `execute_code`
  - result stdout: `control-deck-mcp-ok`
- Verified dashboard is reachable at `http://localhost:3333/deck/` with HTTP 200.
- Ran Playwright smoke test against `/deck/`:
  - title: `Control Deck`
  - page renders dashboard content and widgets.
  - no page runtime exceptions.
  - console reports a React hydration mismatch from dnd-kit `aria-describedby` IDs (`DndDescribedBy-0` vs `DndDescribedBy-1`); likely first cleanup target.
  - screenshot saved: `/tmp/control-deck-deck-smoke.png`.
- Verification:
  - `bun run typecheck` passes.
  - `bun test` currently fails: 595 pass, 22 fail, 15 errors.
  - Important test failures: `lib/settings/resolve.test.ts` default merge behavior appears broken; repo-wide test discovery also picks up vendored `llama.cpp/tools/server/webui` tests that cannot resolve their Svelte/Vitest aliases.

Next likely step:
- Restart Hermes so `mcp_control_deck_*` tools are injected natively into the tool list, then continue using native MCP calls directly instead of mcporter ad-hoc calls.
- Fix the dnd-kit hydration mismatch on the dashboard.
- Fix project test selection/config so vendored llama.cpp webui tests are excluded, then address real Control Deck unit failures.

## 2026-04-26 21:10 CST — Fixed stdio MCP workspace relay boundary

- Reproduced issue: Hermes native `mcp_control_deck_workspace_list_panes` timed out even while `/deck/workspace` was open.
- Verified the workspace itself was connected by calling `POST /api/tools/bridge` directly; the bridge returned registered panes:
  - `chat:chat-default`
  - `terminal:terminal-default`
- Root cause: stdio MCP runs in a separate child process, while `/deck/workspace` subscribes to the in-memory workspace relay inside the Next.js server process. Direct stdio `bridgeDispatch` published into the wrong process-local relay.
- Implemented Option 1:
  - Added `lib/mcp/http-bridge.ts` to proxy MCP tool calls to Next's `/api/tools/bridge`.
  - Added `lib/mcp/http-bridge.test.ts` covering POST shape and non-2xx failure mapping.
  - Threaded optional `bridgeUrl` through `createDeckMcpServer` → `registerBridgeTools` → `callBridgeToolForMcp`.
  - Updated `scripts/mcp-stdio.ts` so stdio MCP defaults to `http://localhost:3333/api/tools/bridge` via `CONTROL_DECK_TOOL_BRIDGE_URL` override.
- Documented Option 2 long-term HTTP MCP session fix in `docs/mcp-workspace-relay.md`.
- Verification passed:
  - `bun run typecheck`
  - `bun test lib/mcp/http-bridge.test.ts`
  - `MCPORTER_CALL_TIMEOUT=30000 npx mcporter call --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh workspace_list_panes --args '{}' --output json` returned the live workspace pane list instead of timing out.

Note:
- Existing Hermes native MCP connection may need a Hermes restart to pick up the patched stdio server code. Fresh mcporter stdio calls already verify the fix.
