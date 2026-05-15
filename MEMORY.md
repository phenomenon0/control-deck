# Control Deck Memory

The agent learns automatically. Update this file when a lesson is durable, operational, and likely to improve future runs. Keep entries short.

## What To Store

- User preferences.
- Project invariants.
- Eval failure lessons.
- Tool failure fixes.
- Repeatable recovery patterns.

## Learning Rules

- If a lesson is factual or preference-shaped, append it here.
- If a lesson is procedural and repeatable, create or update a `skills/<category>/<name>/SKILL.md` file with frontmatter and concise steps.
- Do not store secrets, credentials, one-off transient state, or unverified guesses.
- When a lesson came from a failure, include the symptom, cause, fix, and verification.

## Current Lessons

- User prefers autonomy and learning over excessive permission prompts.
- Default mode is safe mode.
- Free mode may be suggested for broad testing work, long-running jobs, desktop control, or bundled permissions.
- Even in free mode, service restarts and destructive filesystem changes require explicit approval.
- Control Deck prompt quality depends on early capability-denial rules, observe-before-write, one small tool call at a time, and verification before success claims.
- Workspace tools operate Control Deck panes only; they must not be used as workarounds for missing developer, terminal, or native desktop capabilities.
- For Qwen/local models, keep prompts lean and ordered: gates first, routing second, final-response grounding last.
