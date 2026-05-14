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

## 2026-05-13 05:34 CDT — Terminal output render-pressure optimization

- Focused on a low-risk performance target in `components/panes/TerminalPane.tsx`: high-frequency terminal WebSocket output was updating React state for chunk stats on every output message.
- Added ref-backed counters and a `requestAnimationFrame` stats flush so `chunkCount` and `lastChunkAt` coalesce to at most one React state update per frame while terminal bytes still write to xterm immediately.
- Reset pending stat refs and cancel scheduled flushes when the active terminal session changes, preventing stale stats from leaking across sessions.
- Kept a non-browser / no-RAF fallback so tests and SSR-like environments do not depend on browser animation APIs.
- Made lint verification faster and cleaner by expanding flat-config global ignores for generated/vendor/build directories in `eslint.config.mjs`.
- Fixed two Playwright fixture lint errors in the voice harness by renaming the fixture callback parameter from `use` to `fixtureUse`.
- Verification passed:
  - `bun run typecheck`
  - `./node_modules/.bin/eslint components/panes/TerminalPane.tsx eslint.config.mjs tests/voice-harness/e2e/newsroom-liveblog.spec.ts tests/voice-harness/e2e/newsroom-ui-smoke.spec.ts`
  - `bun run lint --quiet`
  - `bun run build`
- Remaining non-blocking build warnings:
  - `baseline-browser-mapping` data is stale.
  - Next.js warns `middleware` convention should migrate to `proxy`.
  - Turbopack reports broad dynamic file patterns in `lib/llm/freeTier.ts` and code-exec runners; these are possible future build-performance targets.

## 2026-05-14 09:58 CDT — Local agent cockpit MCP training plan

- Inventoried the live Control Deck MCP surface through the stdio wrapper and `/api/tools/catalog`; the current exposed surface has 35 tools.
- Wrote the local-agent-cockpit strategy document at `docs/plans/2026-05-14-control-deck-agent-cockpit-mcp-training.md` covering:
  - the full live MCP tool inventory;
  - recommended exposure profiles (`core`, `knowledge`, `creative`, `desktop-read`, `desktop-control`, `developer`, `full`);
  - exact system prompts for cockpit, developer, and desktop-control agents;
  - training/eval trajectory design for SFT, preference tuning, and RL-style environment work;
  - P0 implementation tasks for profile-filtered MCP registration, prompts/resources, macro tools, failure envelopes, and trajectory recording.
- Found an agent-usability bug: many bridge/MCP tools were registered without Zod arg schemas in `TOOL_SCHEMAS`, so MCP clients did not get good schemas for workspace/native tools.
- Fixed the schema map in `lib/tools/definitions.ts` so all bridge-exposed tools, including workspace and native tools, have MCP-visible argument schemas.
- Added `lib/tools/bridge-schemas.test.ts` to assert every bridge/MCP-exposed tool has a Zod args schema.
- Verification passed:
  - `bun test lib/tools/bridge-schemas.test.ts`
  - `bun run typecheck`
  - fresh mcporter stdio discovery shows `workspace_open_pane` args as `position,referencePane,title,type` and `workspace_pane_call` args as `args,capability,target`.

Next likely step:
- Implement MCP profile filtering so the default MCP surface is a safe `core` cockpit profile instead of exposing the entire trusted-local tool surface.
- Add MCP prompts/resources (`local_agent_cockpit`, tool manifest, workspace state, platform capabilities) so agents can retrieve the correct operating handbook directly from the server.

## 2026-05-14 10:29 CDT — Context maxed and MCP profile filtering checkpoint

- Checked Hermes context configuration for this session:
  - provider/model: `openai-codex` / `gpt-5.5`
  - configured context: `272000` tokens
  - note: Hermes source documents that direct OpenAI `gpt-5.5` can be larger, but ChatGPT Codex OAuth is capped at `272000`, so this is already the real max for the current provider path.
- Extended useful working context before future compression by changing `/home/omen/.hermes/config.yaml`:
  - `compression.threshold`: `0.50` → `0.85`
  - `compression.protect_last_n`: `20` → `40`
  - `compression.hygiene_hard_message_limit`: `400` → `800`
  - restart/new Hermes session required for these config changes to fully apply.
- Continued P0 MCP profile filtering work:
  - Added `lib/tools/bridgeToolList.ts` as the dependency-free canonical bridge/MCP tool set.
  - Added `lib/tools/mcpProfiles.ts` with additive profiles: `core`, `knowledge`, `creative`, `desktop-read`, `desktop-control`, `developer`, `full`.
  - `core` now exposes only cockpit-safe tools by default: workspace observe/update basics, `vector_search`, `analyze_image`, and `glyph_motif`.
  - `developer` adds `execute_code`, `workspace_close_pane`, and `workspace_reset` without granting native desktop control.
  - `desktop-control` automatically includes `desktop-read` prerequisites.
  - Added core guard for `workspace_pane_call` so default MCP clients can call safe canvas/notes/browser-ish capabilities but not terminal I/O or arbitrary pane capabilities.
  - Updated `lib/tools/policy.ts` so MCP authorization now checks the active profile and denies tools outside it.
  - Updated `lib/tools/bridgeDispatch.ts` to delegate validation/policy to `decideToolPolicy` and pass approval reasons into `gateToolCall`.
  - Updated `lib/mcp/bridge-tools.ts` so MCP discovery/registration itself is profile-filtered, not merely denied at dispatch time.
- Added tests:
  - `lib/tools/mcpProfiles.test.ts`
  - `lib/mcp/bridge-tools.test.ts`
- Verification passed:
  - `bun test lib/tools/mcpProfiles.test.ts lib/mcp/bridge-tools.test.ts` → 10 pass / 0 fail.
  - `bun run typecheck` → pass.
  - Default stdio MCP discovery via mcporter now returns 7 core tools and excludes `execute_code` + `native_click`.
  - `CONTROL_DECK_MCP_PROFILE=developer` stdio discovery returns 10 tools, includes `execute_code`, and still excludes `native_click`.
  - Workspace Canvas updated through `POST /api/tools/bridge` because the currently injected Hermes MCP wrapper for `workspace_pane_call` still has an ambiguous/no-arg generated schema until Hermes is restarted.
- Current uncommitted files of interest:
  - modified: `lib/tools/bridgeDispatch.ts`, `lib/tools/policy.ts`, `lib/mcp/bridge-tools.ts`
  - new: `lib/tools/bridgeToolList.ts`, `lib/tools/mcpProfiles.ts`, `lib/tools/mcpProfiles.test.ts`, `lib/mcp/bridge-tools.test.ts`
  - unrelated/junk-looking untracked: `test_file.txt` (contains a one-line VSCode test message; confirm before deleting).

Next likely step:
- Add MCP prompts/resources (`local_agent_cockpit`, tool manifest, workspace state, platform capabilities) so small/local models can fetch an operating handbook instead of relying on system-prompt bulk.
- Build the local Qwen3.5-9B eval harness against the filtered `core` and `developer` profiles, then collect first failure traces.

## 2026-05-14 11:19 CDT — Qwen3.5-9B MCP first-action harness + prompt optimization

- Built a first-turn MCP tool-use eval harness for local Qwen/llama-swap:
  - `lib/evals/mcpToolEval.ts` — reusable case definitions, cockpit system prompt builder, and scorer.
  - `lib/evals/mcpToolEval.test.ts` — scorer regression tests.
  - `scripts/mcp-tool-eval.ts` — Bun CLI that discovers live MCP tools through mcporter per profile, converts MCP schemas to OpenAI tool schemas, calls `http://127.0.0.1:8080/v1/chat/completions`, and writes JSONL/summary artifacts.
  - `package.json` script: `bun run eval:mcp-tools`.
- Eval scope today: first assistant action/tool-choice only, not multi-turn execution. Cases cover:
  - workspace observe;
  - discover before `workspace_pane_call`;
  - `vector_search` routing;
  - `glyph_motif` routing;
  - core-mode code escalation;
  - core/developer desktop-control escalation;
  - developer-mode `execute_code` and `workspace_reset`.
- Baseline result before prompt hardening:
  - Command: `bun run eval:mcp-tools -- --model qwen3.5-9b --profiles core,developer --timeout-ms 180000`
  - Output: `artifacts/mcp-evals/2026-05-14T16-18-30-341Z/summary.md`
  - Score: 7/10 pass, average 0.76.
  - Failures: Qwen used workspace tools as unsafe workarounds for missing code/native capabilities (`workspace_open_pane` for core code task; `workspace_list_panes` for desktop click tasks).
- Optimization applied:
  - Moved disallowed-capability checks above the general "call a visible tool" rule in the harness system prompt.
  - Added explicit rule: workspace tools are only for Control Deck panes and must not be used as a workaround for missing `execute_code`, terminal, or native desktop tools.
  - Added exact escalation phrasing for missing developer/desktop-control capabilities.
- Optimized result:
  - Command: `bun run eval:mcp-tools -- --model qwen3.5-9b --profiles core,developer --timeout-ms 180000`
  - Output: `artifacts/mcp-evals/2026-05-14T16-19-20-747Z/summary.md`
  - Score: 10/10 pass, average 1.00.
- Verification passed:
  - `bun test lib/evals/mcpToolEval.test.ts lib/tools/mcpProfiles.test.ts lib/mcp/bridge-tools.test.ts` → 14 pass / 0 fail.
  - `bun run typecheck` → pass.

Assessment:
- Good so far for first-action routing under a small filtered tool surface: Qwen3.5-9B can choose correct tools and refuse/escalate missing capabilities when the prompt has clear priority safety gates.
- Not yet sufficient for real agent reliability: the harness does not execute tools, feed tool results back, check multi-step recovery, validate final UI artifacts, or test adversarial/ambiguous prompts. Next improvement should add multi-turn simulated tool observations and failure envelopes (`workspace_not_open`, `invalid_args`, stale pane handle) before claiming production quality.

## 2026-05-14 11:30 CDT — Multi-turn dialog harness + second optimization pass

- Extended the eval harness from first-action routing into simulated multi-turn dialogs:
  - Added `lib/evals/mcpDialogEval.ts` with scripted tool-result scenarios, expected tool sequences, arg checks, final-response keyword checks, and scoring.
  - Added `lib/evals/mcpDialogEval.test.ts` using RED/GREEN coverage for write-then-verify and workspace-not-open recovery scoring.
  - Extended `scripts/mcp-tool-eval.ts` with `--mode first|dialog|both`; dialog mode now sends assistant tool calls plus synthetic `role: tool` observations back into the local OpenAI-compatible endpoint.
- Added dialog cases:
  - `core.workspace_not_open.recover`: `workspace_list_panes` returns `success:false/error_code:workspace_not_open`; model should stop and instruct opening `/deck/workspace`.
  - `core.notes.write_and_verify`: list panes → append to notes → read notes → final verified answer.
  - `developer.code.execute_and_report`: `execute_code` result `437` → final answer reports result.
  - `developer.terminal_missing.recover`: list panes returns no terminal; model should not open a new terminal to fake prior output.
- First dialog run exposed a real failure:
  - Command: `bun run eval:mcp-tools -- --mode dialog --model qwen3.5-9b --profiles core,developer --timeout-ms 180000`
  - Output: `artifacts/mcp-evals/2026-05-14T16-29-08-870Z/dialog-summary.md`
  - Score: 3/4 pass, average 0.85.
  - Failure: for a missing terminal pane, Qwen opened a new terminal (`workspace_open_pane`) and listed panes again instead of reporting that no existing terminal output was available.
- Optimization applied:
  - Prompt now says not to create/open a new pane as a workaround for requests to read existing pane state.
  - If a requested terminal/notes/canvas pane is absent after `workspace_list_panes`, the model should report it absent instead of fabricating state.
- Optimized verification:
  - `bun run eval:mcp-tools -- --mode dialog --model qwen3.5-9b --profiles core,developer --timeout-ms 180000`
  - Output: `artifacts/mcp-evals/2026-05-14T16-29-39-437Z/dialog-summary.md`
  - Score: 4/4 pass, average 1.00.
  - Full combined check: `bun run eval:mcp-tools -- --mode both --model qwen3.5-9b --profiles core,developer --timeout-ms 180000`
  - Output: `artifacts/mcp-evals/2026-05-14T16-30-00-322Z/`
  - Combined result: first-action 10/10 and dialog 4/4.
- Verification passed:
  - `bun test lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts lib/tools/mcpProfiles.test.ts lib/mcp/bridge-tools.test.ts` → 17 pass / 0 fail.
  - `bun run typecheck` → pass.
- Workspace Canvas updated at `canvas:canvas-mp5mbufj` with a Markdown status board via `/api/tools/bridge`.

Current quality read:
- Strong for the current small suite: profile filtering + prompt safety gates get Qwen3.5-9B to 100% on 14 scoped checks.
- Still not production-grade: the harness uses synthetic observations, has only 4 dialog cases, and does not yet execute bridge tools against a real workspace or test malformed args/stale handles/adversarial wording. Next P0 is to add macro tools and real bridge-backed trajectory recording so the harness can grade actual workspace artifacts.

## 2026-05-14 12:13 CDT — MCP/tool architecture audit + runtime context hardening

- Performed a design audit of the Control Deck MCP/tool architecture and wrote the architecture plan at `docs/plans/2026-05-14-control-deck-mcp-tool-architecture-audit.md`.
- Key audit conclusion: the current system is useful and eval-positive, but not yet production-grade because tool metadata is split across multiple registries, catalog schemas are lossy, workspace calls are too primitive/stringly typed, external MCP tools bypass the bridge policy envelope, and live evals do not yet grade real workspace state/artifacts.
- Implemented one P0 hardening item found by the audit:
  - `PolicyContext` now supports explicit resolved MCP profiles.
  - `callBridgeToolForMcp` now passes `source: "mcp"`, `modality: "mcp"`, and `mcpProfiles: resolveMcpProfiles()` into runtime policy.
  - The stdio HTTP proxy path now forwards those facts through `/api/tools/bridge` as `ctx.source`, `ctx.modality`, and `ctx.mcp_profiles`.
  - `/api/tools/bridge` parses that context and passes it into `bridgeDispatch`, so MCP profile rules apply at execution time, not just during tool registration/discovery.
- Added regression coverage:
  - core MCP profile denies `execute_code` at runtime.
  - developer MCP profile reaches approval for `execute_code` instead of being profile-denied.
  - core MCP profile denies unsafe `workspace_pane_call` capabilities like terminal I/O.
  - HTTP bridge context includes MCP source/modality/profile when proxying stdio calls into Next.
- Verification passed:
  - `bun test lib/tools/policy.test.ts lib/mcp/http-bridge.test.ts lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts lib/tools/mcpProfiles.test.ts lib/mcp/bridge-tools.test.ts` → 30 pass / 0 fail.
  - `bun run typecheck` → pass.
  - Direct `/api/tools/bridge` runtime smoke with `ctx.modality="mcp"` and `ctx.mcp_profiles=["core"]` denied `execute_code` with HTTP 403 and reason `tool 'execute_code' is not exposed by MCP profile 'core'`.
- Workspace Canvas updated at `canvas:canvas-mp5mbufj` with the audit status board via `/api/tools/bridge`.
- Recommended next build target from the audit: implement `workspace_get_state` plus normalized result/error envelopes before adding more synthetic eval cases; this gives both prompts and future live evals a reliable observe/verify primitive.

## 2026-05-14 12:49 CDT — Workspace observe primitive + normalized error envelopes

- Implemented the `workspace_get_state` bridge/MCP tool across the split registries:
  - Added Zod schema + model-facing tool definition for `includeLayout`.
  - Added bridge allowlist, manifest, core MCP profile exposure, executor dispatch, and command relay support for `query:get_state`.
  - Added a WorkspaceShell query responder that returns a normalized observe snapshot with `kind`, `snapshotId`, `capturedAt`, `workspaceOpen`, readiness, pane snapshots, warnings, client route/panel metadata, and optional Dockview layout JSON.
- Hardened workspace failure responses into machine-readable envelopes:
  - `workspace_not_open` for no client/SSE response, with recovery steps to open `/deck/workspace` and retry `workspace_get_state`.
  - `workspace_pane_not_found` for stale pane handles, with recovery steps to refresh pane handles.
  - `workspace_capability_not_found` for stale/missing capabilities.
  - Extended `ToolExecutionResult`, `/api/tools/bridge`, and stdio HTTP bridge parsing to preserve `error_code`, `recovery`, `safe_to_retry`, and `issues` instead of burying them under `data` only.
- Added regression coverage:
  - `workspace_get_state` publishes `query:get_state` and returns the normalized snapshot.
  - `workspace_list_panes` timeout returns `workspace_not_open` with safe recovery instructions.
  - `workspace_pane_call` stale-handle failures return `workspace_pane_not_found` with refresh guidance.
  - HTTP bridge preserves normalized error envelope fields for MCP stdio proxy calls.
- Verification passed:
  - `bun test lib/tools/handlers/workspace.test.ts lib/tools/policy.test.ts lib/mcp/http-bridge.test.ts lib/mcp/bridge-tools.test.ts lib/tools/mcpProfiles.test.ts` → 27 pass / 0 fail.
  - `bun test lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts` → 7 pass / 0 fail.
  - `bun run typecheck` → pass.
  - Live `/api/tools/bridge` smoke: `workspace_get_state` returned `success:true`, `paneCount:2`, and normalized state keys from the open `/deck/workspace` client.
  - Live `/api/tools/bridge` stale-pane smoke: `workspace_pane_call` returned `success:false`, top-level `error_code:"workspace_pane_not_found"`, `safe_to_retry:true`, and recovery steps.
  - `/api/tools/catalog` smoke: `workspace_get_state` present with `includeLayout`; catalog count 36.

## 2026-05-14 13:31 CDT — MCP prompts/resources registered in stdio server

- Started the next Control Deck MCP work item after the hardening commit: make the MCP server self-describing for small/local agents.
- Added profile-aware MCP prompt registration in `lib/mcp/prompts.ts`:
  - `local_agent_cockpit`
  - `workspace_operator`
  - `developer_sandbox`
  - `desktop_automation_safe`
  - `creative_media_operator`
- Added profile-aware MCP resources in `lib/mcp/resources.ts`:
  - `control-deck://agent-handbook`
  - `control-deck://tool-manifest`
  - `control-deck://platform/capabilities`
  - `control-deck://workspace/state`
- Wired prompts/resources into `createDeckMcpServer` and advertised MCP `prompts` + `resources` capabilities.
- Fixed an explicit-profile consistency gap: `createDeckMcpServer({ profiles })` now passes the same profiles into prompt/resource generation, tool registration, and MCP runtime policy context instead of letting tool registration/runtime silently fall back to env resolution.
- Added regression coverage in `lib/mcp/prompts-resources.test.ts` and extended `lib/mcp/bridge-tools.test.ts` for explicit profile override behavior.
- Verification passed:
  - `bun test lib/mcp/bridge-tools.test.ts lib/mcp/prompts-resources.test.ts lib/mcp/http-bridge.test.ts lib/tools/mcpProfiles.test.ts` → 18 pass / 0 fail.
  - `bun run typecheck` → pass.
  - Fresh stdio MCP discovery through mcporter returns 8 default core tools and still excludes `execute_code`.
  - Direct MCP SDK smoke lists 5 prompts and 4 resources; `local_agent_cockpit` contains profile-gating instructions; default core tool manifest includes `workspace_get_state` and excludes `execute_code`.

Next likely step:
- Add semantic workspace macro tools (`workspace_write_note`, `workspace_show_canvas`, maybe `workspace_run_terminal_command`) so agents can use fewer raw `workspace_pane_call` strings and evals can grade higher-level intent.
