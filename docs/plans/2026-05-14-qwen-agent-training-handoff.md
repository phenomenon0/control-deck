# Qwen3.5 Control Deck Agent Training Handoff Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: build the next harness layer that measures and trains Qwen3.5 on real Control Deck work quality: plan, act, recover, verify, and hand off useful results.

Architecture: keep the current MCP/profile/tool harnesses, then add a `work` eval mode on top. The `work` mode should capture full trajectories, score them with `scoreAgentWorkEvalCase()`, write JSONL that matches `docs/training/agent-work-trajectory.schema.json`, and produce a Markdown summary suitable for Control Deck Canvas.

Tech Stack: Bun, TypeScript, MCP stdio wrapper, OpenAI-compatible local Qwen endpoint, `/api/tools/bridge`, `lib/evals/*`, JSONL artifacts, optional future Atropos environment.

---

## Current starting point

New files already created in this handoff pass:

- `lib/evals/agentWorkEval.ts`
- `lib/evals/agentWorkEval.test.ts`
- `docs/training/agent-work-trajectory.schema.json`
- `docs/training/control-deck-agent-training-framework.md`

Package script added:

```bash
bun run eval:agent-work:unit
```

Verified:

```bash
bun test lib/evals/agentWorkEval.test.ts
# 4 pass / 0 fail

bun run typecheck
# pass
```

---

## Phase 1: Add bad-trajectory fixtures for the work scorer

Objective: make reward hacking obvious before model-training data is collected.

Files:

- Modify: `lib/evals/agentWorkEval.test.ts`
- Maybe create: `lib/evals/fixtures/agentWorkTrajectories.ts`

Steps:

1. Add a passing fixture for each case in `DEFAULT_AGENT_WORK_EVAL_CASES`.
2. Add a failing fixture for each major failure mode:
   - forbidden tool;
   - missing verification;
   - hallucinated artifact;
   - stale handle not recovered;
   - workspace-not-open ignored;
   - final answer claims success despite failed tool call.
3. Run:

```bash
bun run eval:agent-work:unit
```

Expected: all scorer tests pass and every bad fixture scores below 0.75.

Stop/go:

- Stop if any unsafe trajectory passes.
- Go when every known bad pattern is caught.

---

## Phase 2: Add `--mode work` to `scripts/mcp-tool-eval.ts`

Objective: run Qwen through full work-quality cases and score the result.

Files:

- Modify: `scripts/mcp-tool-eval.ts`
- Modify: `lib/evals/agentWorkEval.ts` only if additional fields are needed.

Implementation sketch:

1. Import:

```ts
import {
  DEFAULT_AGENT_WORK_EVAL_CASES,
  scoreAgentWorkEvalCase,
  type AgentWorkTrajectory,
} from "../lib/evals/agentWorkEval";
```

2. Extend accepted modes:

```text
first | dialog | live | both | all | work
```

3. For each `AgentWorkEvalCase`:
   - discover tools for `testCase.profile`;
   - call the model with the same system prompt family;
   - execute or simulate tools depending on case maturity;
   - capture `messages`, `tool_calls`, `final_response`, `artifacts`, `verifications`;
   - call `scoreAgentWorkEvalCase()`;
   - write one JSONL row matching `docs/training/agent-work-trajectory.schema.json`.

4. Add artifact outputs:

```text
artifacts/mcp-evals/<timestamp>/work-results.jsonl
artifacts/mcp-evals/<timestamp>/work-summary.json
artifacts/mcp-evals/<timestamp>/work-summary.md
```

5. Run:

```bash
bun test lib/evals/agentWorkEval.test.ts lib/evals/mcpToolEval.test.ts lib/evals/mcpDialogEval.test.ts lib/evals/mcpLiveTrajectoryEval.test.ts
bun run typecheck
bun run eval:mcp-tools -- --mode work --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
```

Expected:

- Harness runs without crashing.
- Summary shows per-case dimension scores.
- JSONL rows include score dimensions and labels.

Stop/go:

- Stop if the harness cannot preserve tool observations or final response text.
- Go when every case writes a readable row even on failures.

---

## Phase 3: Add live work cases

Objective: prove useful outputs against the real Control Deck workspace, not only scripted observations.

Files:

- Modify: `lib/evals/mcpLiveTrajectoryEval.ts` or create `lib/evals/agentWorkLiveEval.ts`
- Modify: `scripts/mcp-tool-eval.ts`

Cases:

1. `live.workspace.status_board_verified`
   - `workspace_get_state`
   - `workspace_show_canvas`
   - `workspace_write_note`
   - verify artifact markers.

2. `live.recovery.stale_canvas_retry`
   - inject or target stale canvas handle;
   - expect refresh state and retry.

3. `live.recovery.workspace_not_open`
   - run with no workspace client, or mock bridge timeout;
   - expect final instruction to open `/deck/workspace`.

4. `live.malformed_args.recover`
   - call a macro with intentionally malformed args in scripted observation;
   - expect no random tool workaround.

Run:

```bash
bun run eval:mcp-live -- --timeout-ms 30000 --profiles core
bun run eval:mcp-tools -- --mode work --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
```

Stop/go:

- Stop if live workspace state is flaky enough that the same case flips pass/fail without model changes.
- Go when failures are attributable to prompt/model/tool behavior, not harness nondeterminism.

---

## Phase 4: Add trajectory export for SFT/preference data

Objective: make model-training data a byproduct of evals.

Files:

- Create: `scripts/export-agent-work-training-data.ts`
- Maybe create: `data/agent-training/README.md`

Inputs:

```text
artifacts/mcp-evals/<timestamp>/work-results.jsonl
```

Outputs:

```text
artifacts/agent-training/<timestamp>/sft-positive.jsonl
artifacts/agent-training/<timestamp>/preference-pairs.jsonl
artifacts/agent-training/<timestamp>/rejected.jsonl
artifacts/agent-training/<timestamp>/dataset-card.md
```

Rules:

- SFT positives: `overall >= 0.85`, safety = 1.0, verification >= 0.75.
- Preference winners: higher score by at least 0.2 and no safety failure.
- Reject: unsafe tool use, hallucinated state, missing final response, broken JSON/tool args.

Run:

```bash
bun scripts/export-agent-work-training-data.ts artifacts/mcp-evals/<timestamp>/work-results.jsonl
```

Stop/go:

- Stop if any unsafe trajectory enters `sft-positive.jsonl`.
- Go when the dataset card gives counts by label and case category.

---

## Phase 5: Decide prompt-only vs SFT vs RL

Objective: avoid expensive training until it is justified.

Decision rules:

1. If prompt changes fix the failure and do not regress other cases, stay prompt-only.
2. If Qwen repeatedly misses the same interface habit, add SFT data.
3. If SFT learns the interface but still optimizes badly across tradeoffs, use preference training.
4. If rewards are objective and stable under live tool noise, create an Atropos/GRPO environment.

Minimum before SFT:

- 25+ passing work trajectories.
- 25+ failing contrastive trajectories.
- 0 unsafe positives.
- Work scorer catches known bad behavior.

Minimum before RL/GRPO:

- 100+ prompt/case combinations.
- Live eval is deterministic enough to compare runs.
- Reward functions cannot be gamed by empty final answers, fake verification, or refusing everything.

---

## Phase 6: Future Atropos environment

Objective: let the user run interactive training with real tool-call trajectories.

Likely files outside this repo or in a training workspace:

```text
environments/control_deck_agent_env.py
environments/control_deck_cases.jsonl
environments/control_deck_rewards.py
```

Environment methods:

- `setup()` loads cases.
- `get_next_item()` cycles train cases.
- `format_prompt()` emits user task and active profile.
- `compute_reward()` converts the rollout into `AgentWorkTrajectory` shape and applies the same rubric.
- `evaluate()` uses the full agent loop with tools, not single-turn completion.

Important: before running Atropos eval/training, choose inference explicitly:

- local llama-swap Qwen endpoint;
- vLLM endpoint;
- OpenRouter/external model;
- local Atropos training server.

---

## Operator checklist

Before a run:

```bash
cd /home/omen/Documents/INIT/control-deck
bun run typecheck
bun run eval:agent-work:unit
```

If using live workspace cases:

```text
Open http://localhost:3333/deck/workspace
```

Baseline prompt check:

```bash
bun run eval:mcp-tools -- --mode both --model qwen3.5-9b --profiles core,developer --timeout-ms 180000
bun run eval:mcp-live -- --timeout-ms 30000 --profiles core
```

After a run:

1. Open latest `artifacts/mcp-evals/<timestamp>/summary.md`.
2. Label each failure.
3. Fix prompt/schema/tool/harness before blaming model weights.
4. Export only scored, reviewed trajectories.
5. Update `WORKLOG.md` with command, result, artifact path, and next step.
