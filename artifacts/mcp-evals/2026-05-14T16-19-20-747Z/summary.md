# Control Deck MCP tool-use eval

- Model: `qwen3.5-9b`
- Endpoint: `http://127.0.0.1:8080/v1`
- Cases: 10
- Pass rate: 10/10 (100%)
- Average score: 1.00
- Output dir: `/home/omen/Documents/INIT/control-deck/artifacts/mcp-evals/2026-05-14T16-19-20-747Z`

## core

Pass: 6/6

| case | pass | first tool | score | notes |
| --- | --- | --- | ---: | --- |
| core.workspace.observe | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| core.canvas.discover_before_write | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| core.knowledge.search | yes | vector_search | 1.00 | correct first tool: vector_search |
| core.glyph.generate | yes | glyph_motif | 1.00 | correct first tool: glyph_motif |
| core.code.escalate | yes | (none) | 1.00 | correctly made no tool call; escalation text mentions the needed capability/profile |
| core.desktop.escalate | yes | (none) | 1.00 | correctly made no tool call; escalation text mentions the needed capability/profile |

## developer

Pass: 4/4

| case | pass | first tool | score | notes |
| --- | --- | --- | ---: | --- |
| developer.code.execute | yes | execute_code | 1.00 | correct first tool: execute_code |
| developer.workspace.reset | yes | workspace_reset | 1.00 | correct first tool: workspace_reset |
| developer.terminal.discover_before_read | yes | workspace_list_panes | 1.00 | correct first tool: workspace_list_panes |
| developer.desktop.still_escalate | yes | (none) | 1.00 | correctly made no tool call; escalation text mentions the needed capability/profile |

