# Control Deck MCP session handoff — 2026-05-14 10:29 CDT

This file exists so a future Hermes session can resume without relying on chat context.

## Current Hermes context config

- Config path: `/home/omen/.hermes/config.yaml`
- Current provider/model: `openai-codex` / `gpt-5.5`
- Current `model.context_length`: `272000`
- This is already the max for ChatGPT Codex OAuth. Hermes source notes direct OpenAI `gpt-5.5` can be 1.05M, but the Codex OAuth backend caps `gpt-5.5` at 272K.
- Changed compression settings to use more of the available context:
  - `compression.threshold = 0.85`
  - `compression.protect_last_n = 40`
  - `compression.hygiene_hard_message_limit = 800`
- These apply fully after a Hermes restart/new session. They cannot restore messages already compacted.

## Active objective

Make Control Deck a good local-agent cockpit/MCP environment, especially for Qwen3.5-9B/local model tool use. Do not reduce Control Deck to a harness only; the cockpit/product surface matters.

Task ladder:

1. Re-discover Control Deck MCP/tools, prompts, docs, and eval harness state.
2. Audit MCP/tool design and improve tool/prompt architecture.
3. Run Qwen3.5-9B against tool-use/prompt evals via local llama-swap.
4. Optimize prompts/harness based on failures and re-test.
5. Persist findings in `WORKLOG.md` and update the Canvas/workspace when available.

## Repo and live endpoints

- Repo: `/home/omen/Documents/INIT/control-deck`
- Deck: `http://localhost:3333/deck/`
- Workspace: `http://localhost:3333/deck/workspace`
- Bridge: `http://localhost:3333/api/tools/bridge`
- Stdio MCP wrapper: `/home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh`
- Local llama-swap OpenAI-compatible endpoint: `http://127.0.0.1:8080/v1`
- Available local models seen this session: `qwen3.5-35b`, `qwen3.5-9b`, `qwen3.6`

## Work completed in this checkpoint

Implemented MCP profile filtering so the default external agent surface is safe and smaller:

- New `lib/tools/bridgeToolList.ts`: canonical dependency-free set of bridge/MCP tool names.
- New `lib/tools/mcpProfiles.ts`: profile parser and exposure model.
- Updated `lib/tools/policy.ts`: MCP modality now denies tools outside active profile and blocks unsafe `workspace_pane_call` capabilities in non-unsafe profiles.
- Updated `lib/tools/bridgeDispatch.ts`: validation/policy now flows through `decideToolPolicy`; approval-required policy reasons are passed into `gateToolCall`.
- Updated `lib/mcp/bridge-tools.ts`: tool registration/discovery is filtered by the active MCP profile, not just denied at call time.
- New tests:
  - `lib/tools/mcpProfiles.test.ts`
  - `lib/mcp/bridge-tools.test.ts`

## Current profile behavior

Default/no env:

- Profile resolves to `core`.
- Stdio MCP discovery returns 7 tools:
  - `workspace_list_panes`
  - `workspace_open_pane`
  - `workspace_focus_pane`
  - `workspace_pane_call`
  - `vector_search`
  - `analyze_image`
  - `glyph_motif`
- Explicitly excludes `execute_code` and `native_click`.

`CONTROL_DECK_MCP_PROFILE=developer`:

- Stdio MCP discovery returns 10 tools.
- Adds:
  - `execute_code`
  - `workspace_close_pane`
  - `workspace_reset`
- Still excludes `native_click`.

Other profiles in code:

- `knowledge`: adds `vector_store`, `vector_ingest`
- `creative`: adds image/audio/3D generation/edit tools
- `desktop-read`: adds native UI read/screen/tree/cache tools
- `desktop-control`: adds native UI control tools and automatically includes `desktop-read`
- `full`: exposes the whole bridge surface

## Verification already run

From `/home/omen/Documents/INIT/control-deck`:

```bash
bun test lib/tools/mcpProfiles.test.ts lib/mcp/bridge-tools.test.ts
bun run typecheck
```

Result: both passed; 10 tests passed.

MCP discovery verification:

```bash
MCPORTER_CALL_TIMEOUT=30000 npx mcporter list \
  --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh \
  --name control_deck --output json
```

Default/core result: 7 tools, no `execute_code`, no `native_click`.

```bash
CONTROL_DECK_MCP_PROFILE=developer MCPORTER_CALL_TIMEOUT=30000 npx mcporter list \
  --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh \
  --name control_deck --output json
```

Developer result: 10 tools, includes `execute_code`, excludes `native_click`.

Workspace Canvas was updated via direct `POST /api/tools/bridge` to `canvas:canvas-mp5mbufj`. The currently injected Hermes MCP wrapper for `workspace_pane_call` still has an ambiguous/no-arg generated schema in this running session; restart Hermes to reload the improved schemas, or use the bridge POST workaround from the `control-deck-operations` skill.

## Current uncommitted status

As of this handoff, important changes are:

- Modified:
  - `lib/tools/bridgeDispatch.ts`
  - `lib/tools/policy.ts`
  - `lib/mcp/bridge-tools.ts`
  - `WORKLOG.md`
- Added:
  - `lib/tools/bridgeToolList.ts`
  - `lib/tools/mcpProfiles.ts`
  - `lib/tools/mcpProfiles.test.ts`
  - `lib/mcp/bridge-tools.test.ts`
  - `docs/plans/2026-05-14-control-deck-mcp-session-handoff.md`
- Unrelated/junk-looking untracked:
  - `test_file.txt` — one-line VSCode test file. Confirm before deleting.

Run `git status --short` to refresh before editing.

## Next best step

Add MCP prompts/resources so local/small agents can retrieve concise operating instructions directly from the server instead of depending on a huge system prompt.

Suggested P0 resources/prompts:

1. `local_agent_cockpit` prompt:
   - role: local agent driving Control Deck
   - tool-selection rules
   - workspace pane workflow
   - safe capability list for core
   - escalation rule: ask for higher profile (`developer`, `desktop-control`, `full`) when needed
2. Tool manifest resource:
   - active profile
   - registered tools
   - short risk and side-effect notes
3. Workspace state resource:
   - current panes/capabilities when workspace is open
4. Platform capabilities resource:
   - native automation support by OS, workspace requirements, bridge URL

After prompts/resources, build the first Qwen3.5-9B eval harness:

- Use local endpoint `http://127.0.0.1:8080/v1`.
- For deterministic Qwen3.5/Qwen3.6 calls, include `chat_template_kwargs.enable_thinking=false` or content may come back empty.
- Evaluate both `core` and `developer` profile tool lists.
- First evals should target:
  - choose `workspace_list_panes` before `workspace_pane_call`
  - refuse/avoid `execute_code` under `core`
  - safe canvas/notes update path
  - profile escalation when terminal/native control is requested
  - malformed args recovery

## Resume prompt for future Hermes

Resume Control Deck MCP cockpit work from `/home/omen/Documents/INIT/control-deck`. Load the `control-deck-operations` skill. Read `WORKLOG.md` and `docs/plans/2026-05-14-control-deck-mcp-session-handoff.md`. The latest checkpoint implemented profile-filtered MCP registration/policy with passing tests. Continue with MCP prompts/resources for `local_agent_cockpit`, tool manifest, workspace state, and platform capabilities, then build/run Qwen3.5-9B evals through local llama-swap at `http://127.0.0.1:8080/v1`.
