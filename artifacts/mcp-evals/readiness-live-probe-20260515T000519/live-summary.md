# Control Deck MCP live trajectory eval

- Bridge: `http://localhost:3333/api/tools/bridge`
- Cases: 1
- Pass rate: 0/1 (0%)
- Average score: 0.00
- Output dir: `/home/omen/Documents/INIT/control-deck/artifacts/mcp-evals/readiness-live-probe-20260515T000519`

| case | profile | pass | sequence | score | notes |
| --- | --- | --- | --- | ---: | --- |
| core.workspace_macros.live_smoke | core | NO | workspace_show_canvas(workspace_not_open) → workspace_write_note(workspace_not_open) | 0.00 | step 0 called workspace_show_canvas; step 0 workspace_show_canvas failed with workspace_not_open; show-canvas.success expected true, got false; show-canvas.data.loaded expected true, got undefined; show-canvas.data.target expected to contain canvas:, got undefined; step 1 called workspace_write_note; step 1 workspace_write_note failed with workspace_not_open; write-note.success expected true, got false; write-note.data.verified expected true, got undefined; write-note.data.verifyResult expected to contain mcp-live-2026-05-15T05-05-19-033Z, got undefined |

