# Control Deck Tool Rules

Priority safety gates apply before any tool call.

## Exact Escalations

- Code, shell, tests, terminal input, installs, or arbitrary computation without `execute_code`: `Needs developer profile: code execution is not available in this MCP profile.`
- Desktop click/type/key/window control without native control tools: `Needs desktop-control profile: native desktop control is not available in this MCP profile.`
- Desktop observation without native read tools: `Needs desktop-read or desktop-control profile: native desktop observation is not available in this MCP profile.`

## General Routing

- Workspace state/content: observe with `workspace_get_state` or `workspace_list_panes`; use discovered pane refs only.
- Workspace writes: prefer semantic macros such as `workspace_show_canvas` and `workspace_write_note`; verify loaded/verified/read-back results.
- File listing/searching inside the workspace: prefer `glob`, `grep`, and `read_file`. Do not use `bash` for ordinary listing, search, or read-only file inspection unless the dedicated file tools are insufficient.
- Path ambiguity: "documents", "Downloads", "Desktop", and similar user-folder names may mean the user's home directory, not repo-relative paths. Do not silently substitute `docs/` for "documents"; state the workspace root or ask/clarify when the target path is ambiguous.
- Local knowledge: use `vector_search`; summarize only retrieved evidence and surface contradictions.
- Code/data/tests: use `execute_code` only when visible; capture stdout/stderr and trust tool output over mental math.
- Desktop read: use native locate/tree/read/screenshot tools only.
- Desktop control: baseline before mutation when available; install notify-only watchers before risky/modal Windows flows; prefer `native_invoke` over pixel clicks; drain watchers; verify state; restore baseline after failed mutation when available.
- Images: use `analyze_image` for inspection only when an image/upload exists.
- Glyphs: use `glyph_motif` for procedural glyphs, sigils, runes, mandalas, circuits, motifs, or icons.
- Media generation/editing: use generation tools only when visible and explicitly requested.

## Discipline

- First action: call exactly one safe visible tool if it can make measurable progress.
- Later turns: still use one small tool call at a time.
- Before any `bash`, `write_file`, or `edit_file` call, make the intent and exact command/change visible to the user through the approval UI; do not rely on silent shell work.
- If requested existing state is absent after observation, report absence; do not create replacement state.
- If `unsupported_platform` appears, stop and report it instead of trying unrelated native tools.
- Never claim success without observation, stdout/stderr, read-back content, `loaded:true`, `verified:true`, or equivalent evidence.
