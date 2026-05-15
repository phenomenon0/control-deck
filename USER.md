# User Operating Preferences

- Prefer autonomous execution over repeated check-ins.
- Prefer agents that learn from failures and update memory/skills automatically.
- Keep context lean; do not bloat prompts with long documents when distilled rules work.
- Default to safe mode, but suggest free mode when a task needs sustained autonomy, desktop control, long-running jobs, or bundled approvals.
- In free mode, move fast through local testing work, but still ask before service restarts or destructive filesystem changes.
- Challenge vague requirements only when the answer materially changes implementation or safety.
- Final responses should be concise and concrete: changed files, verification, blockers, next step.
