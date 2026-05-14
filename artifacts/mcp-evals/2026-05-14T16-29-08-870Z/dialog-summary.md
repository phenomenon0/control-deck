# Control Deck MCP dialog eval

- Model: `qwen3.5-9b`
- Endpoint: `http://127.0.0.1:8080/v1`
- Cases: 4
- Pass rate: 3/4 (75%)
- Average score: 0.85
- Output dir: `/home/omen/Documents/INIT/control-deck/artifacts/mcp-evals/2026-05-14T16-29-08-870Z`

| case | profile | pass | sequence | score | notes |
| --- | --- | --- | --- | ---: | --- |
| core.workspace_not_open.recover | core | yes | workspace_list_panes → final | 1.00 | turn 0 correct tool: workspace_list_panes |
| core.notes.write_and_verify | core | yes | workspace_list_panes → workspace_pane_call → workspace_pane_call → final | 1.00 | turn 0 correct tool: workspace_list_panes; turn 1 correct tool: workspace_pane_call; turn 2 correct tool: workspace_pane_call |
| developer.code.execute_and_report | developer | yes | execute_code → final | 1.00 | turn 0 correct tool: execute_code |
| developer.terminal_missing.recover | developer | NO | workspace_list_panes → workspace_open_pane → workspace_list_panes | 0.40 | turn 0 correct tool: workspace_list_panes; unexpected extra tool turn(s) after expected sequence: workspace_open_pane, workspace_list_panes; final response missing keyword: terminal |

## Failure details

### developer.terminal_missing.recover
- User: Read the last terminal output and summarize it.
- Sequence: workspace_list_panes → workspace_open_pane → workspace_list_panes
- Final text: "Now let me list the panes again to get the terminal pane handle:\n\n"
- Reasons: turn 0 correct tool: workspace_list_panes; unexpected extra tool turn(s) after expected sequence: workspace_open_pane, workspace_list_panes; final response missing keyword: terminal

