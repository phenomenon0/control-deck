# Control Deck Agent Training Framework

Date: 2026-05-14
Repo: `/home/omen/Documents/INIT/control-deck`
Primary target: Qwen3.5-9B local agent driving Control Deck through MCP.

## Executive intent

The goal is not just "can Qwen call a tool?" The goal is:

1. Understand the user's intent.
2. Select the right MCP profile/capability.
3. Observe state before acting.
4. Execute one small step at a time.
5. Recover from normalized tool failures.
6. Verify visible artifacts/state before claiming success.
7. Produce a useful handoff that a human can drive.

This framework turns that into a measurable training loop: prompt evals first, then SFT data from good trajectories, then preference/RL training once the rewards are trustworthy.

## What exists now

Implemented harness layers:

- First-action routing: `lib/evals/mcpToolEval.ts`
- Simulated multi-turn dialogs: `lib/evals/mcpDialogEval.ts`
- Live bridge-backed macro trajectories: `lib/evals/mcpLiveTrajectoryEval.ts`
- Work-quality rubric/scorer: `lib/evals/agentWorkEval.ts`
- Work-quality unit tests: `lib/evals/agentWorkEval.test.ts`
- Training trajectory schema: `docs/training/agent-work-trajectory.schema.json`

Useful commands:

```bash
cd /home/omen/Documents/INIT/control-deck
bun test lib/evals/agentWorkEval.test.ts
bun run eval:agent-work:unit
bun test lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts lib/evals/mcpLiveTrajectoryEval.test.ts lib/evals/agentWorkEval.test.ts
bun run typecheck
bun run eval:mcp-tools -- --mode both --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
bun run eval:mcp-live -- --timeout-ms 30000 --profiles core
```

## Research takeaways encoded into the framework

### MCP-Bench / Complex MCP style evals

Recent MCP benchmarks emphasize that realistic tool agents need more than schema-level function calling:

- MCP-Bench frames evaluation across tool schema understanding, trajectory-level planning, and task completion. It stresses fuzzy user instructions, cross-tool coordination, multi-hop trajectories, and grounding final answers in intermediate outputs.
- ComplexMCP explicitly targets stateful, interdependent, noisy tool sandboxes. Its reported bottlenecks map directly onto Control Deck risks:
  - tool retrieval saturation as action spaces grow;
  - over-confidence where agents skip verification;
  - strategic defeatism where agents rationalize failure instead of recovering.

Control Deck response:

- Keep MCP profiles small by default.
- Score trajectory quality, not just the first tool.
- Make normalized errors and recovery paths part of the task.
- Require read-back/verification for workspace writes.

Sources checked:

- `https://arxiv.org/abs/2508.20453` — MCP-Bench abstract/API metadata.
- `https://arxiv.org/abs/2605.10787` — ComplexMCP abstract/API metadata.

### tau-bench / tau2-bench style user-in-the-loop tasks

Tau-style benchmarks model real tasks where agents must coordinate with users and a changing world, not simply call one API. Tau2-bench adds dual-control: both agent and user can act in shared state.

Control Deck response:

- Add future cases where the user must open `/deck/workspace`, approve a profile switch, provide a missing upload, or decide whether to continue after a tool failure.
- Grade whether the agent gives a crisp human action request instead of trying random tools.

Sources checked:

- `https://arxiv.org/abs/2506.07982`
- `https://github.com/sierra-research/tau2-bench`

### SWE-agent / Agent-Computer Interface lesson

SWE-agent's main lesson for Control Deck is that the interface exposed to agents is itself a product surface. A better agent-computer interface changes agent behavior.

Control Deck response:

- Prefer semantic workspace macros (`workspace_show_canvas`, `workspace_write_note`, future `workspace_run_terminal_command`) over raw `workspace_pane_call` strings.
- Keep raw primitives as fallback, but train/eval on the semantic interface.
- Treat prompts, tool schemas, normalized error envelopes, and visible artifact verification as the model's operating system.

Source checked:

- `https://arxiv.org/abs/2405.15793`

### Qwen function calling lesson

Qwen's own function-calling docs say Qwen-Agent is the canonical Qwen3 function-calling path and warn against stopword/ReAct-style tool call templates for reasoning models because thought text can accidentally contain stopwords. The docs also show passing `chat_template_kwargs.enable_thinking=false` through OpenAI-compatible APIs.

Control Deck response:

- Keep using OpenAI-style tool schemas, not ReAct stopwords.
- For deterministic local Qwen3.x/Qwen3.5 evals through llama-swap/OpenAI-compatible endpoints, keep:

```json
{
  "chat_template_kwargs": { "enable_thinking": false },
  "temperature": 0
}
```

Source checked:

- `https://qwen.readthedocs.io/en/latest/framework/function_call.html`

### Atropos / GRPO training lesson

Atropos is a trajectory environment framework for async LLM RL and multi-turn tool calling. Its public README reports tool-calling environment improvements on Berkeley Function Calling Benchmark task types. TRL GRPO is a practical route when rewards are objective enough and multiple completions can be compared.

Control Deck response:

- Do not jump to RL first.
- Build reliable eval/reward functions first.
- Use SFT on high-quality trajectories to teach the interface.
- Use GRPO/Atropos only after the scorer catches safety, grounding, recovery, and verification failures.

Sources checked:

- `https://github.com/NousResearch/atropos`
- `https://huggingface.co/docs/trl/main/en/grpo_trainer`

## Training ladder

### Stage 0 — Prompt-only viability

Purpose: establish a prompt baseline before changing weights.

Inputs:

- `buildMcpToolEvalSystemPrompt()` variants.
- Current `core` and `developer` MCP profiles.
- Qwen3.5-9B through `http://127.0.0.1:8080/v1`.

Run:

```bash
bun run eval:mcp-tools -- --mode both --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
bun run eval:mcp-live -- --timeout-ms 30000 --profiles core
```

Go criteria:

- First-action routing >= 95%.
- Simulated dialog >= 90%.
- Live macro smoke passes.
- Zero forbidden-tool safety failures.

### Stage 1 — Work-quality eval expansion

Purpose: stop optimizing only tool selection.

Use `DEFAULT_AGENT_WORK_EVAL_CASES` in `lib/evals/agentWorkEval.ts` as the seed suite. Add cases for:

1. Workspace visible artifact creation and verification.
2. Workspace-not-open recovery.
3. Core profile capability boundaries.
4. Developer sandbox compute/verify/report.
5. Local knowledge search with grounded summary.
6. Stale pane handle refresh/retry.
7. Handoff creation with tests and stop/go criteria.

Go criteria:

- Unit scorer tests pass.
- Scripted trajectories for every case pass/fail in expected ways.
- The scorer produces useful reason strings for failures.

### Stage 2 — Trajectory capture and labeling

Purpose: create SFT-ready examples and preference pairs.

Record each run as JSONL matching:

- `docs/training/agent-work-trajectory.schema.json`

Minimum fields:

- `case_id`
- `profile`
- `prompt_variant`
- `messages`
- `visible_tools`
- `tool_calls`
- `artifacts`
- `verifications`
- `final_response`
- `scores`
- `labels`

Labels to collect:

- `good`
- `unsafe-tool`
- `missing-verification`
- `hallucinated-state`
- `malformed-args`
- `over-tooling`
- `grounded`
- `useful-final`

Initial data target:

- 100 clean scripted trajectories.
- 100 live successful trajectories.
- 100 failure/recovery trajectories.
- 100 contrastive bad trajectories from Qwen failures.
- 25-50 human-reviewed gold handoffs.

Do not train on unlabeled live traces until they are scored and spot-checked.

### Stage 3 — SFT

Purpose: teach the interface and work loop before RL.

Recommended SFT examples:

- System prompt + user prompt + visible tools.
- Assistant tool call.
- Tool observation.
- Assistant next tool call or final response.
- Include recoveries as positive examples when the agent stops and reports the blocker correctly.

Positive behavior to teach:

- Observe before workspace writes.
- Use semantic macros first.
- Read normalized error envelopes.
- Retry only when `safe_to_retry=true` or recovery says to retry.
- Verify before claiming success.
- Use concise final handoffs.

Negative examples to exclude or convert into preference data:

- Calls tools outside the active MCP profile.
- Opens new panes to fake missing existing state.
- Claims a write succeeded without read-back/loaded result.
- Continues after `workspace_not_open` by trying unrelated tools.
- Uses ReAct/free-text tool syntax instead of actual tool calls.

### Stage 4 — Preference training or GRPO/RL

Purpose: improve behavior that prompt/SFT cannot lock in.

Reward dimensions from `scoreAgentWorkEvalCase()`:

- completion: required task done.
- tool discipline: correct tools, no forbidden tools, reasonable call count.
- verification: read-back or result evidence exists.
- grounding: final response follows observations/errors.
- safety: no unsafe capability workaround or forbidden claims.

Start with preference pairs:

- good verified trajectory vs unverified but plausible trajectory.
- correct profile escalation vs unsafe workaround.
- stale-handle recovery vs giving up.
- concise handoff vs verbose ungrounded answer.

Only move to GRPO/Atropos once rewards are stable and hard to game.

### Stage 5 — Atropos environment

Purpose: train/evaluate a model in a real multi-turn Control Deck environment.

Target environment shape:

- `setup()` loads `AgentWorkEvalCase` tasks.
- `format_prompt()` emits the user task and active profile.
- The environment exposes profile-filtered MCP tools.
- The agent loop records messages/tool calls/results/artifacts.
- `compute_reward()` calls `scoreAgentWorkEvalCase()` plus live artifact checks.
- `evaluate()` runs the full agent loop, not single-turn chat completion.

Stop criteria before running expensive RL:

- Local tests pass.
- The scorer catches known bad trajectories.
- The live harness is deterministic enough to compare runs.
- No reward gives high scores to unsafe tool use.

## Test matrix

### Unit / scorer tests

```bash
bun run eval:agent-work:unit
bun test lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts lib/evals/mcpLiveTrajectoryEval.test.ts lib/evals/agentWorkEval.test.ts
```

### Type safety

```bash
bun run typecheck
```

### Synthetic model evals

```bash
bun run eval:mcp-tools -- --mode first --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
bun run eval:mcp-tools -- --mode dialog --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
bun run eval:mcp-tools -- --mode both --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
```

### Live workspace evals

Requires `/deck/workspace` open in a browser client:

```bash
bun run eval:mcp-live -- --timeout-ms 30000 --profiles core
```

### Profile/tool discovery smoke

```bash
MCPORTER_CALL_TIMEOUT=30000 npx -y mcporter list \
  --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh \
  --name control_deck --schema --output json

CONTROL_DECK_MCP_PROFILE=developer MCPORTER_CALL_TIMEOUT=30000 npx -y mcporter list \
  --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh \
  --name control_deck --schema --output json
```

Expected:

- Core exposes semantic workspace macros and safe tools only.
- Developer includes `execute_code`.
- Native desktop write tools are not visible unless a desktop-control profile is explicitly selected.

## Driver workflow for the user

1. Open Control Deck workspace:

```text
http://localhost:3333/deck/workspace
```

2. Run unit/type checks.

3. Run prompt-only evals against Qwen3.5.

4. Inspect latest artifact directory:

```text
artifacts/mcp-evals/<timestamp>/
```

5. For every failure, label the root cause:

- prompt gap;
- tool schema gap;
- profile/policy gap;
- missing macro;
- workspace/live-state flake;
- Qwen capability gap.

6. If it is a prompt gap, add one explicit rule and rerun.

7. If it is a tool/schema/profile gap, fix the Control Deck interface before training.

8. If it is a true model capability gap, add the trace to SFT/preference data.

9. Only train after the harness catches the failure class reliably.

## Immediate next implementation steps

1. Wire `AgentWorkEvalCase` into `scripts/mcp-tool-eval.ts` as a new `--mode work`.
2. Export model trajectories to JSONL matching `docs/training/agent-work-trajectory.schema.json`.
3. Add scripted bad-trajectory fixtures so scorer regressions cover reward hacking.
4. Add live cases for:
   - stale canvas handle recovery;
   - workspace-not-open recovery;
   - malformed macro args;
   - profile escalation;
   - verified handoff artifact creation.
5. Add a small labeling CLI:

```bash
bun scripts/label-agent-work-trajectory.ts artifacts/mcp-evals/<run>/work-results.jsonl
```

6. Start SFT only after the work eval suite has at least 25 passing and 25 failing labeled examples.
