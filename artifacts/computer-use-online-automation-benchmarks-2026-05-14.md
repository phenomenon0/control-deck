# Computer-use / online automation benchmark scan

Timestamp: 2026-05-14 22:05 CDT

Goal: find the current best benchmarks and online automation testbeds for benchmarking computer-use agents, especially a Control Deck/MCP-style agent that can drive browser, desktop, workspace panes, tools, and native UI.

## Short answer

Use a layered benchmark stack. No single benchmark covers the full surface.

Recommended benchmark stack:

1. OSWorld-Verified — primary full-desktop computer-use benchmark.
2. BrowserGym + WebArena-Verified — primary reproducible browser-agent harness.
3. VisualWebArena — browser tasks where visual grounding matters.
4. WorkArena — enterprise/knowledge-work browser tasks, especially ServiceNow-style workflows.
5. Online-Mind2Web + BrowserArena — live/open-web online automation stress tests; use after reproducible benchmarks because live web is noisy.
6. WebChoreArena + Mind2Web 2 — long-horizon, tedious, information-heavy web tasks.
7. Windows Agent Arena and AndroidWorld — OS/mobile breadth.
8. ScreenSpot-Pro — microbenchmark for high-resolution GUI grounding.
9. TheAgentCompany + MCPVerse — workplace/tool-rich/MCP-style task layers.
10. Cua-Bench/HUD — useful orchestration platforms for running CUA benchmarks at scale, especially OSWorld-style and custom desktop tasks.

For Control Deck specifically, start with BrowserGym/WebArena-Verified plus OSWorld-Verified, then add a Control-Deck-native trajectory suite that grades MCP tool order, failure envelopes, workspace artifact verification, and native UI safety.

## Ranking: best benchmarks for our likely use case

### 1. OSWorld-Verified

Best for: full computer-use agents that operate desktop/web apps through screenshots/actions.

Why it matters:
- OSWorld is explicitly a scalable real computer environment for multimodal agents with task setup, execution-based evaluation, and interactive learning across Ubuntu, Windows, and macOS.
- The 2025 OSWorld-Verified upgrade fixed community-reported examples, added AWS support to reduce eval time to under/around an hour, and updated benchmark results.
- The OSWorld-Verified blog says the update addressed 300+ issues and moved infrastructure from VMware/Docker to AWS with 50x parallelization.

Use it as the flagship external CUA benchmark.

Caveats:
- Desktop environment setup and action-space matching still matter.
- Scores can be sensitive to whether the agent has privileged APIs, screenshots only, accessibility tree, or custom tools.
- Need apples-to-apples action-space disclosure.

Sources:
- https://os-world.github.io/
- https://xlang.ai/blog/osworld-verified
- https://arxiv.org/abs/2404.07972

### 2. BrowserGym + WebArena-Verified

Best for: reproducible browser automation testing and web-agent research.

Why it matters:
- BrowserGym is an open, easy-to-use, extensible framework to implement, test, and evaluate web agents.
- BrowserGym includes MiniWoB, WebArena, WebArenaVerified, VisualWebArena, WorkArena, AssistantBench, and WebLINX according to the ServiceNow BrowserGym README.
- WebArena is a realistic, reproducible web environment with functional websites from common domains such as e-commerce, social/forum discussion, collaborative software development, and content management.
- WebArena-Verified is the newer verified release: curated, version-controlled web tasks plus deterministic evaluators over agent responses and captured network traces.

Use this as the day-one browser benchmark harness.

Caveats:
- WebArena is still a sandboxed/simulated web, not the wild open internet.
- Visual state, hidden DOM state, and direct tool affordances must be normalized when comparing agents.

Sources:
- https://github.com/ServiceNow/BrowserGym
- https://github.com/ServiceNow/webarena-verified
- https://servicenow.github.io/webarena-verified/v1.2.3/
- https://webarena.dev/
- https://arxiv.org/abs/2307.13854

### 3. VisualWebArena

Best for: multimodal browser agents where screenshot/layout/visual content matters.

Why it matters:
- VisualWebArena was designed to assess multimodal web agents on realistic visually grounded tasks.
- It fills the gap where text-only DOM or accessibility snapshots miss visual web information.

Use it when benchmarking screenshot+browser agents or Control Deck browser panes that expose vision.

Caveats:
- If an agent gets a rich DOM/accessibility tree, separate that condition from screenshot-only results.

Sources:
- https://arxiv.org/abs/2401.13649
- https://github.com/web-arena-x/visualwebarena

### 4. WorkArena

Best for: enterprise browser automation / knowledge-worker workflows.

Why it matters:
- WorkArena is a remote-hosted benchmark of 33 tasks based on the widely-used ServiceNow platform.
- It measures common knowledge-work tasks rather than generic browsing.
- It introduced/uses BrowserGym as an environment with multimodal observations and a rich action set.

Use it to test whether an agent can drive realistic business apps, not just toy sites.

Caveats:
- ServiceNow-specific workflows may overrepresent ticket/workflow UIs.
- Access/setup may be more involved than MiniWoB/WebArena.

Sources:
- https://servicenow.github.io/WorkArena/
- https://arxiv.org/abs/2403.07718

### 5. Online-Mind2Web

Best for: live-web, online automation realism.

Why it matters:
- The 2025 paper “An Illusion of Progress? Assessing the Current State of Web Agents” argues prior benchmark results are over-optimistic.
- It introduces Online-Mind2Web: 300 realistic tasks across 136 websites, allowing evaluation under conditions closer to real user web use.

Use it as an online stress test after the reproducible suite.

Caveats:
- Live sites drift, break, block bots, add captchas, change layouts, and create non-determinism.
- It is excellent for field realism but weaker for tight regression testing unless task snapshots and traces are preserved.

Sources:
- https://arxiv.org/abs/2504.01382
- https://hal.cs.princeton.edu/online_mind2web

### 6. BrowserArena

Best for: open-web arena-style live comparison.

Why it matters:
- BrowserArena is described as a live open-web agent evaluation platform that collects user-submitted tasks, runs head-to-head comparisons, and gathers step-level human feedback.
- It surfaces real-world failure modes such as captchas, pop-up banners, and direct URL navigation.

Use it for live bakeoffs and qualitative failure-mode analysis.

Caveats:
- Not ideal as the first regression suite because open-web conditions are unstable.
- Human feedback and pairwise comparisons are useful but slower/more expensive.

Sources:
- https://arxiv.org/abs/2510.02418

### 7. WebChoreArena

Best for: long, tedious, labor-heavy browser chores.

Why it matters:
- WebChoreArena extends WebArena with 532 reproducible tasks.
- It targets massive-memory, calculation, and rule-persistence challenges that short browsing tasks miss.

Use it to test long-horizon persistence and “can it finish the boring work?” rather than simple page navigation.

Caveats:
- Longer tasks are costlier and can blur perception, memory, planning, and arithmetic failure modes unless traces are deeply instrumented.

Sources:
- https://webchorearena.github.io/
- https://arxiv.org/abs/2506.01952

### 8. Mind2Web 2

Best for: agentic search and long-horizon live browsing.

Why it matters:
- Mind2Web 2 has 130 realistic, high-quality, long-horizon tasks requiring real-time browsing and extensive information gathering.
- It introduces agent-as-a-judge evaluation.

Use it for research-style agentic search, not just point-and-click browser use.

Caveats:
- Judge quality becomes part of the benchmark; validate evaluator behavior for our own use.

Sources:
- https://arxiv.org/abs/2506.21506
- https://osu-nlp-group.github.io/Mind2Web-2/

### 9. Windows Agent Arena

Best for: Windows desktop agents at scale.

Why it matters:
- Windows Agent Arena is a scalable Windows AI agent platform with 150+ agent tasks and parallelized evaluation.
- Useful if we want to compare native Windows UI automation, UIA, screenshots, and desktop apps.

Caveats:
- Windows-specific; not a Linux/GNOME benchmark.
- For Control Deck Linux native tools, use it only as cross-platform reference or later Windows target.

Sources:
- https://microsoft.github.io/WindowsAgentArena/
- https://github.com/microsoft/WindowsAgentArena

### 10. AndroidWorld / GUIOdyssey

Best for: mobile GUI agents.

Why it matters:
- AndroidWorld has 116 programmatic tasks across 20 real-world Android apps, with dynamic task instantiation, initialization, success checking, and teardown.
- GUIOdyssey covers cross-app mobile GUI navigation with 8,834 episodes, 212 apps, and about 1.4K app combinations.

Use if mobile is in scope.

Caveats:
- Not directly comparable to desktop/web results.
- Requires Android/device/emulator automation stack.

Sources:
- https://google-research.github.io/android_world/
- https://arxiv.org/abs/2405.14573
- https://github.com/OpenGVLab/GUI-Odyssey
- https://arxiv.org/abs/2406.08451

### 11. ScreenSpot-Pro

Best for: GUI grounding, not full task completion.

Why it matters:
- ScreenSpot-Pro evaluates high-resolution professional GUI grounding across 23 applications, five industries, and three operating systems.
- Existing GUI grounding models perform poorly; the cited best model in the paper reached only 18.9%.

Use as a diagnostic sub-benchmark for perception/click-target grounding.

Caveats:
- It does not measure planning, recovery, or full task success.
- Pair it with OSWorld or WAA for end-to-end evaluation.

Sources:
- https://arxiv.org/abs/2504.07981
- https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding

### 12. TheAgentCompany

Best for: workplace-style consequential tasks in a simulated company.

Why it matters:
- It benchmarks LLM agents on real-world professional tasks involving computer and internet use.
- Useful for multi-tool workflows beyond pure browser/desktop control.

Caveats:
- Heavier scenario benchmark; likely later-stage evaluation.

Sources:
- https://the-agent-company.com/
- https://arxiv.org/abs/2412.14161

### 13. MCPVerse

Best for: MCP/tool-rich agents rather than pure GUI control.

Why it matters:
- MCPVerse is an expansive real-world benchmark for agentic tool use.
- It integrates 550+ real-world executable tools and an action space above 140k tokens.

Use it if we want to benchmark Control Deck’s MCP/tool selection behavior separately from visual computer control.

Caveats:
- Tool-use benchmark, not GUI automation benchmark.
- Some external MCP servers/tools can drift or disappear; pin versions where possible.

Sources:
- https://arxiv.org/abs/2508.16260
- https://github.com/hailsham/mcpverse

### 14. WebVoyager

Best for: older but widely referenced real-site web-agent comparison.

Why it matters:
- WebVoyager introduced an online web browsing environment using Selenium and a benchmark of real-world tasks from 15 popular websites.
- OpenAI’s CUA launch cited 87% on WebVoyager and 58.1% on WebArena, so it is useful for comparing against public claims.

Caveats:
- Evaluation can rely on multimodal LLM judging; task/site drift and benchmark audit issues matter.
- Prefer WebArena-Verified / Online-Mind2Web / BrowserArena for newer work.

Sources:
- https://arxiv.org/html/2401.13919v3
- https://github.com/MinorJerry/WebVoyager
- https://ai.azure.com/catalog/models/computer-use-preview

## External model-result anchor points

These are useful only as sanity anchors; benchmark conditions must be matched before making claims.

- Anthropic announced Claude 3.5 Sonnet computer-use beta in Oct 2024 and cited 14.9% on OSWorld screenshot-only.
  Source: https://www.anthropic.com/news/3-5-models-and-computer-use

- OpenAI/Azure model catalog for `computer-use-preview` says CUA achieved 38.1% on OSWorld, 58.1% on WebArena, and 87% on WebVoyager.
  Source: https://ai.azure.com/catalog/models/computer-use-preview

Do not compare our agent to these numbers unless we match benchmark version, action space, observation space, model, tool policy, and human-assistance policy.

## Benchmark-the-benchmarks rubric

Score each candidate suite on:

1. Reproducibility: fixed environment, task versioning, deterministic evaluator.
2. Realism: real apps/sites/workflows vs synthetic widgets.
3. Verification quality: state-based or execution-based success checks beat LLM-only judging.
4. Observation/action fairness: screenshot-only, DOM, accessibility tree, APIs, MCP tools, and native UI events must be declared.
5. Trace quality: step-level logs, screenshots, DOM/accessibility snapshots, network traces, tool calls, and final state.
6. Setup cost: local Docker/VM/cloud time, account requirements, secrets, bot defenses.
7. Online/live stress: ability to test against drift, popups, captchas, and real user messiness.
8. Safety controls: credential isolation, sandboxing, approval gates, destructive-action prevention.
9. Regression usefulness: can we run it in CI or nightly and trust deltas?
10. Fit to Control Deck: browser panes, workspace panes, MCP tools, native UI, terminal/code execution, media/vector tools.

## Recommended Control Deck evaluation plan

### Phase 0 — internal Control Deck live trajectory harness

Purpose: test our actual MCP/workspace/native semantics before external benchmarks.

Cases to keep:
- first-action routing across MCP profiles;
- multi-turn tool-use dialogs;
- `workspace_show_canvas` / `workspace_write_note` visible artifact verification;
- native Linux/desktop-read probes;
- desktop-control safety: baseline, watcher, invoke/click, drain events, restore on failure;
- failure envelopes: unsupported platform, missing pane, stale workspace handle, screenshot portal failure.

Metrics:
- success/completion;
- required tool order;
- tool discipline;
- recovery behavior;
- latency/cost;
- artifact verification.

### Phase 1 — browser regression suite

Use BrowserGym as the harness:
- MiniWoB for cheap browser-control sanity.
- WebArena-Verified for reproducible realistic web tasks.
- VisualWebArena for visual grounding.
- WorkArena for enterprise app workflows.

This gives us a stable nightly benchmark before trying live web.

### Phase 2 — full desktop CUA suite

Use OSWorld-Verified as the flagship.

If Windows becomes a product target, add Windows Agent Arena.

Track separate conditions:
- screenshot-only;
- screenshot + accessibility tree;
- browser DOM;
- native MCP/AT-SPI/UIA;
- tool-rich Control Deck MCP profile.

### Phase 3 — online/live web stress

Use Online-Mind2Web and BrowserArena.

Do not use these as the only benchmark. Use them to find real-world blockers: captchas, popups, changing layouts, bot detection, auth/account flows, and long-form information gathering.

### Phase 4 — long-horizon and tool-rich work

Add:
- WebChoreArena for tedious long browser chores.
- Mind2Web 2 for agentic search.
- TheAgentCompany for simulated professional work.
- MCPVerse for massive MCP/tool-selection behavior.

### Phase 5 — grounding microbenchmarks

Add ScreenSpot-Pro to isolate high-resolution click/target grounding failures from planning/tool-use failures.

## Practical next steps

1. Create a `benchmarks/` area in Control Deck with adapters for:
   - BrowserGym/WebArena-Verified;
   - OSWorld-Verified;
   - Control-Deck-native MCP trajectory cases.

2. Define a standard trace schema:
   - task id/version;
   - environment version;
   - observation modality;
   - action modality;
   - model/provider;
   - prompts/profile;
   - tool calls/actions;
   - screenshots/DOM/accessibility snapshots;
   - final evaluator result;
   - error/recovery envelope;
   - elapsed time and token/cost stats.

3. Run a smoke benchmark first:
   - 5 MiniWoB tasks;
   - 5 WebArena-Verified tasks;
   - 3 OSWorld-Verified tasks;
   - 5 Control Deck MCP trajectory tasks.

4. Then scale to a weekly benchmark matrix:
   - BrowserGym stable suite nightly;
   - OSWorld-Verified weekly;
   - Online-Mind2Web/BrowserArena monthly/manual due live-web variance;
   - MCPVerse and TheAgentCompany when tool/workplace workflows are ready.

## Bottom line

Best immediate pairing:

- Reproducible browser automation: BrowserGym + WebArena-Verified + VisualWebArena + WorkArena.
- Full desktop computer-use: OSWorld-Verified.
- Real live online automation: Online-Mind2Web + BrowserArena.
- Control Deck-specific truth: internal MCP live trajectory harness, because public GUI benchmarks will not measure our workspace panes, MCP failure envelopes, vector/media/code tools, or safety policy.
