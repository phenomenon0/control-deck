# Control Deck MCP dialog eval

- Model: `qwen3.5-9b`
- Endpoint: `http://127.0.0.1:8080/v1`
- Cases: 4
- Pass rate: 4/4 (100%)
- Average score: 1.00
- Output dir: `/home/omen/Documents/INIT/control-deck/artifacts/mcp-evals/2026-05-14T16-29-39-437Z`

| case | profile | pass | sequence | score | notes |
| --- | --- | --- | --- | ---: | --- |
| core.workspace_not_open.recover | core | yes | workspace_list_panes → final | 1.00 | turn 0 correct tool: workspace_list_panes |
| core.notes.write_and_verify | core | yes | workspace_list_panes → workspace_pane_call → workspace_pane_call → final | 1.00 | turn 0 correct tool: workspace_list_panes; turn 1 correct tool: workspace_pane_call; turn 2 correct tool: workspace_pane_call |
| developer.code.execute_and_report | developer | yes | execute_code → final | 1.00 | turn 0 correct tool: execute_code |
| developer.terminal_missing.recover | developer | yes | workspace_list_panes → final | 1.00 | turn 0 correct tool: workspace_list_panes |

