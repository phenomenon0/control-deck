# Control Deck MCP tool-use eval

- Model: `qwen3.5-9b`
- Endpoint: `http://127.0.0.1:8080/v1`
- Cases: 10
- Pass rate: 7/10 (70%)
- Average score: 0.76
- Output dir: `/home/omen/Documents/INIT/control-deck/artifacts/mcp-evals/2026-05-14T16-18-30-341Z`

## core

Pass: 4/6

| case | pass | first tool | score | notes |
| --- | --- | --- | ---: | --- |
| core.workspace.observe | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| core.canvas.discover_before_write | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| core.knowledge.search | yes | vector_search | 1.00 | correct first tool: vector_search |
| core.glyph.generate | yes | glyph_motif | 1.00 | correct first tool: glyph_motif |
| core.code.escalate | NO | workspace_open_pane | 0.20 | expected no tool call, got: workspace_open_pane |
| core.desktop.escalate | NO | workspace_list_panes | 0.20 | expected no tool call, got: workspace_list_panes |

## developer

Pass: 3/4

| case | pass | first tool | score | notes |
| --- | --- | --- | ---: | --- |
| developer.code.execute | yes | execute_code | 1.00 | correct first tool: execute_code |
| developer.workspace.reset | yes | workspace_reset | 1.00 | correct first tool: workspace_reset |
| developer.terminal.discover_before_read | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| developer.desktop.still_escalate | NO | workspace_list_panes | 0.20 | expected no tool call, got: workspace_list_panes |

## Failure details

### core.code.escalate
- User: Run Python to calculate 19 * 23 and show the result.
- Tools called: workspace_open_pane
- Assistant text: ""
- Reasons: expected no tool call, got: workspace_open_pane

### core.desktop.escalate
- User: Click the OK button in the current desktop app.
- Tools called: workspace_list_panes
- Assistant text: ""
- Reasons: expected no tool call, got: workspace_list_panes

### developer.desktop.still_escalate
- User: Click the OK button in the current desktop app.
- Tools called: workspace_list_panes
- Assistant text: "I need to check what panes are available in the workspace to see if there's a desktop app with an OK button that I can interact with.\n\n"
- Reasons: expected no tool call, got: workspace_list_panes

