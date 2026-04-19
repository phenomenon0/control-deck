// Shared fake data for the "working session" scenario.
// A data-analyst using Control Deck across several runs.

const SESSION_THREADS = [
  { id: "t1", title: "Q3 retention cohort analysis",    time: "Today · 2:14p",  on: true,  runs: 4 },
  { id: "t2", title: "Churn predictors — SHAP values",  time: "Today · 11:02a", on: false, runs: 6 },
  { id: "t3", title: "Customer support call scripts",   time: "Yesterday",      on: false, runs: 2 },
  { id: "t4", title: "ComfyUI seed sweep, portrait-v4", time: "Yesterday",      on: false, runs: 11 },
  { id: "t5", title: "Voice-note to standup summary",   time: "Mon",            on: false, runs: 1 },
  { id: "t6", title: "Rewrite RFP section 4 for tone",  time: "Mon",            on: false, runs: 3 },
  { id: "t7", title: "Scrape docs.anthropic.com",       time: "Sun",            on: false, runs: 2 },
];

const SESSION_HISTORY = [
  {
    id: "r1",
    ask: "Load the retention parquet from S3 and show me 30/60/90 day cohort retention split by acquisition channel.",
    response: "Loaded `retention_q3.parquet` — 1.8M rows across 12 channels. Organic and referral cohorts retain substantially better than paid; paid-social drops to 9% by D90 while organic holds at 34%.",
    ops: [
      { tool: "execute_code", label: "Code", arg: "pandas.read_parquet", dur: "2.1s", status: "done" },
      { tool: "execute_code", label: "Code", arg: "cohort_matrix(df, by='channel')", dur: "4.8s", status: "done" },
      { tool: "generate_image", label: "Chart", arg: "heatmap(retention)", dur: "1.2s", status: "done" },
    ],
    artifact: { kind: "chart-heat", name: "retention_by_channel.png", meta: "2400×1400 · 312 KB" },
    time: "2:14p",
  },
  {
    id: "r2",
    ask: "What's driving the paid-social drop? Pull SHAP for days 0-30.",
    response: "The three strongest predictors of early churn in paid-social are: **session depth on D0** (negative if < 2 pages), **weekday of signup** (Fri/Sat spike churn by 18%), and **referring creative** (video-A underperforms static by a wide margin).",
    ops: [
      { tool: "execute_code", label: "Code", arg: "xgb.fit(cohort_features, Y)", dur: "11.4s", status: "done" },
      { tool: "execute_code", label: "Code", arg: "shap.TreeExplainer(model)",  dur: "3.7s", status: "done" },
      { tool: "generate_image", label: "Chart", arg: "shap.summary_plot", dur: "0.9s", status: "done" },
    ],
    artifact: { kind: "chart-shap", name: "shap_summary_d30.png", meta: "1800×1200 · 248 KB" },
    time: "2:22p",
  },
  {
    id: "r3",
    ask: "Cross-reference with the reactivation campaigns from H1 — did any recover the Fri/Sat signups?",
    response: "Partially. **R-07** recovered 23% of Fri/Sat signups by D45 — nearly double the baseline campaign. The winning pattern was delayed first-touch (day 3) with a soft, utility-focused message rather than discount.",
    ops: [
      { tool: "vector_search", label: "Lookup",  arg: "reactivation H1 cohort",    dur: "0.3s", status: "done" },
      { tool: "execute_code",  label: "Code",    arg: "merge_cohorts(r_campaigns)", dur: "1.6s", status: "done" },
    ],
    artifact: null,
    time: "2:28p",
  },
  // r4 is the *active* one — simulated
];

const SESSION_ACTIVE_PROMPT =
  "Draft the slide deck outline — five slides, lead with the paid-social finding, close with an experiment plan.";

// what the agent "says" when the simulated run completes
const ACTIVE_RESPONSE = `Here's a tight five-slide cut that leads with the loss and ends with the next bet.

**1 · The number** — Paid-social D90 retention is **9%**, versus 34% for organic. Frame as an unhealthy gap, not a ceiling.

**2 · What drives it** — SHAP identifies three variables that together explain 68% of early loss: session depth, day-of-signup, and creative.

**3 · The one that's fixable** — Day-of-signup is a distribution mismatch we can move; creative is a slower lever.

**4 · What already works** — R-07's delayed first-touch recovered 23% of Fri/Sat signups in H1. Generalizable pattern.

**5 · The experiment** — Two-cell test on Fri/Sat signups only, 4 weeks, primary metric D45 retention.

Want me to generate a speaker-notes draft per slide?`;

const ACTIVE_OPS = [
  { tool: "vector_search",   label: "Lookup", arg: "deck templates — analytical",    dur: 620 },
  { tool: "execute_code",    label: "Code",   arg: "summarize_run_chain(r1,r2,r3)",   dur: 1400 },
  { tool: "generate_image",  label: "Chart",  arg: "bar(retention_delta_90d)",        dur: 1100 },
];

const MODELS = [
  { name: "gpt-5",               tag: "Cloud",  size: "—",      ctx: "200K", latency: "fast",  desc: "Frontier reasoning across code, vision, and long context. Default for complex analytical runs.", chips: ["vision", "tools", "json"], on: true  },
  { name: "claude-opus-4.5",     tag: "Cloud",  size: "—",      ctx: "200K", latency: "med",   desc: "Strongest for long-form synthesis and careful copywriting. Preferred for deck and document work.", chips: ["vision", "tools"], on: false },
  { name: "llama-3.3-70b",       tag: "Local",  size: "42 GB",  ctx: "128K", latency: "slow",  desc: "Runs on-device via Ollama. Good for routine transformations when privacy matters.", chips: ["local", "tools"], on: false },
  { name: "qwen-2.5-coder-32b",  tag: "Local",  size: "18 GB",  ctx: "32K",  latency: "med",   desc: "Local code model. Best-in-class for execute_code tool calls under 50 LOC.", chips: ["local", "code"], on: false },
  { name: "gemini-2.0-flash",    tag: "Cloud",  size: "—",      ctx: "1M",   latency: "fast",  desc: "Cheapest long-context option. Use for whole-repo lookups.", chips: ["vision", "cheap"], on: false },
  { name: "mistral-small-3",     tag: "Local",  size: "14 GB",  ctx: "32K",  latency: "fast",  desc: "Fastest local responder. Good default for interactive voice.", chips: ["local", "fast"], on: false },
];

Object.assign(window, { SESSION_THREADS, SESSION_HISTORY, SESSION_ACTIVE_PROMPT, ACTIVE_RESPONSE, ACTIVE_OPS, MODELS });
