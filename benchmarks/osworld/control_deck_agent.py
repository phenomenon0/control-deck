#!/usr/bin/env python3
"""
Control Deck → OSWorld agent adapter.

Implements the OSWorld AgentInterface (predict + reset). Receives
{instruction, obs} where obs has keys {"screenshot": bytes, "a11y_tree": str}
and returns (response_dict, actions_list) where actions are pyautogui code
strings or one of the sentinels DONE / WAIT / FAIL.

Two execution modes (controlled by --exec):
  pyautogui   — emit pyautogui code; OSWorld's controller runs it. This is
                the leaderboard-comparable mode.
  native      — emit pyautogui shims that route to Control Deck's native_*
                tools via the local CLI (`bun lib/tools/native/cli.ts ...`).
                Off-leaderboard, but lets us measure what OUR stack lands.

Why split: leaderboard fairness = same execution layer for everyone. Our
edge is in the planning/perception loop, not in click reliability.
"""
from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from openai import OpenAI

DONE = "DONE"
WAIT = "WAIT"
FAIL = "FAIL"
SENTINELS = {DONE, WAIT, FAIL}

ExecMode = Literal["pyautogui", "native"]
ObservationType = Literal["screenshot", "a11y_tree", "screenshot_a11y_tree"]

SYS_PROMPT = """You are an autonomous agent operating a real Linux desktop on behalf of a user.

You will receive an instruction plus one or both of: a screenshot of the current desktop and a linearized accessibility tree. Decide the next action(s).

Output rules:
- Respond with ONE python code block per action you want to take, using ```python ... ``` fences.
- Always use the `pyautogui.` prefix. A bare `click(...)` raises NameError and wastes a step.
- After the action(s), if the task is complete, output DONE on its own line.
- If you need to wait (e.g. for a page to load) before the next observation, output WAIT.
- If the task is impossible, output FAIL with one sentence of reason.

You operate a real Linux VM. Compose the primitives below however the task requires — there is no fixed recipe.

PRIMITIVES — ACTION LAYER
- Mouse:     pyautogui.click(x, y) / doubleClick / rightClick / moveTo / dragTo
- Keyboard:  pyautogui.write("text", interval=0.05) / press("enter") / hotkey("ctrl","l") / keyDown / keyUp
- Scroll:    pyautogui.scroll(n) / hscroll(n)
- Shell:     `import subprocess; subprocess.run([...], capture_output=True, text=True)` or `subprocess.Popen([...])` — FULL shell access inside the VM.
- Filesystem: `import os, shutil, pathlib` — read, write, move, glob, anything.
- Every Linux CLI is installed in the VM: gio, xdotool, wmctrl, xdg-open, find, grep, sed, mv, cp, dbus-send, gsettings, gnome-terminal, nautilus, firefox, libreoffice, ...

PRIMITIVES — PERCEPTION LAYER
- screenshot: PNG of the current desktop. Useful for context. UNRELIABLE for picking click coordinates.
- a11y_tree: linearized AT-SPI dump. EVERY interactive widget has its exact `(x=X y=Y w=W h=H)` printed. THIS is your source of truth for clicks. Use `click(x + w//2, y + h//2)`.

STRATEGY HINTS — invent your own combinations, do NOT follow recipes
- Many desktop tasks have a CLI path that skips the GUI entirely (file ops, app launches, URL opens, settings changes). If a one-liner achieves the goal, run it via subprocess and emit DONE.
- GUI path: launch the right app first (subprocess.Popen, or Super-key + type app name + Enter), wait, then act using a11y-tree coordinates.
- Keyboard often beats mouse: Tab focuses, arrows navigate lists, Enter activates, F10 opens menu bar, the Menu key opens context menus, Ctrl+L jumps to address bars.
- If a click did nothing (tree unchanged), DO NOT repeat it. Switch tool — try the shell, try a hotkey, try a different app, try right-clicking instead of left.
- The screenshot can lie about positions; the a11y tree does not.

NEVER
- Click a coordinate guessed from the screenshot when the a11y tree contains the target widget.
- Repeat an action that produced no observable change.
- Assume an application has a particular shortcut without confirming it works (Ctrl+Z is NOT a universal undo — it is application-specific and many apps do not bind it).

Coordinates are absolute pixel coordinates on the visible desktop. Be terse — no narration."""

# pyautogui functions that the model commonly emits without the module prefix.
# We auto-prefix them at parse time so a bare `click(140, 200)` still executes
# instead of NameError-ing in OSWorld's controller. Keep this list tight — only
# functions that are unambiguous pyautogui calls.
_PYAUTOGUI_BARE_FUNCS = (
    "click", "doubleClick", "rightClick", "tripleClick", "mouseDown", "mouseUp",
    "moveTo", "moveRel", "dragTo", "dragRel",
    "write", "typewrite", "press", "keyDown", "keyUp", "hotkey",
    "scroll", "hscroll", "screenshot",
)
_BARE_PYAUTOGUI_CALL = re.compile(
    r"(?P<indent>^[ \t]*)(?P<fn>" + "|".join(_PYAUTOGUI_BARE_FUNCS) + r")\s*\(",
    re.MULTILINE,
)


def _autoprefix_pyautogui(code: str) -> str:
    """Prepend `pyautogui.` to bare top-level calls of known pyautogui funcs.

    Why: smaller models drop the module prefix ~20% of the time and the action
    crashes with NameError inside the VM, burning a step for nothing. Cheap
    static rewrite recovers most of those.

    We only touch tokens that are clearly call sites (`name(`) and only at
    line-start indentation (so `pyautogui.click(...)`'s inner `click` is safe,
    and a string literal `"click("` mid-line is safe too).
    """
    def repl(m: re.Match[str]) -> str:
        # Don't double-prefix if the preceding non-space char is `.` (already
        # qualified, e.g. `pyautogui.click`). The MULTILINE/indent guard already
        # blocks most of that, but check the indent boundary char for safety.
        return f"{m.group('indent')}pyautogui.{m.group('fn')}("
    return _BARE_PYAUTOGUI_CALL.sub(repl, code)


@dataclass
class AgentTrace:
    instruction: str
    raw_response: str
    parsed_actions: list[str]
    observation_summary: dict[str, Any] = field(default_factory=dict)


def _format_a11y(a11y_tree: str | None, max_chars: int = 12000) -> str:
    if not a11y_tree:
        return "(no accessibility tree provided)"
    if len(a11y_tree) <= max_chars:
        return a11y_tree
    head = a11y_tree[: max_chars // 2]
    tail = a11y_tree[-max_chars // 2 :]
    return f"{head}\n... [truncated {len(a11y_tree) - max_chars} chars] ...\n{tail}"


def _parse_response(text: str) -> list[str]:
    """Pull pyautogui code blocks and sentinel tokens out of model output.

    Order matters: we preserve the order the agent emitted, so a sequence
    like "click → DONE" runs the click then signals completion.
    """
    actions: list[str] = []
    # Walk the text linearly, alternating between code blocks and plain text.
    cursor = 0
    pattern = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)
    for m in pattern.finditer(text):
        # Look at the prose between the previous cursor and this code block
        # for sentinel tokens.
        between = text[cursor : m.start()]
        for tok in re.findall(r"\b(DONE|WAIT|FAIL)\b", between):
            actions.append(tok)
        code = m.group(1).strip()
        if code:
            actions.append(_autoprefix_pyautogui(code))
        cursor = m.end()
    for tok in re.findall(r"\b(DONE|WAIT|FAIL)\b", text[cursor:]):
        actions.append(tok)
    return actions


class ControlDeckAgent:
    """OSWorld-compatible agent. See module docstring for contract."""

    def __init__(
        self,
        model: str | None = None,
        observation_type: ObservationType = "screenshot_a11y_tree",
        exec_mode: ExecMode = "pyautogui",
        max_tokens: int = 4096,
        base_url: str | None = None,
        api_key: str | None = None,
        client: OpenAI | None = None,
    ):
        # OpenAI-compatible everywhere: works with llama-swap (default),
        # OpenAI proper, and Anthropic's OAI-compat endpoint. Backend-
        # agnostic execution = fair leaderboard comparison.
        self.model = model or os.environ.get("OSWORLD_AGENT_MODEL", "qwen3.5-9b")
        self.observation_type = observation_type
        self.exec_mode = exec_mode
        self.max_tokens = max_tokens
        if client is None:
            self.client = OpenAI(
                base_url=base_url or os.environ.get("OSWORLD_AGENT_BASE_URL", "http://127.0.0.1:8080/v1"),
                api_key=api_key or os.environ.get("OSWORLD_AGENT_API_KEY", "local"),
            )
        else:
            self.client = client
        self.last_trace: AgentTrace | None = None

    def reset(self, _runtime_logger: Any = None) -> None:
        self.last_trace = None

    def predict(self, instruction: str, obs: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        screenshot: bytes | None = obs.get("screenshot")
        a11y_tree: str | None = obs.get("a11y_tree")

        # OpenAI chat-completions content: list of {type: text|image_url}
        # parts. Vision-capable local models (Qwen2.5-VL/Qwen3.5-VL via
        # llama-swap, GPT-4o, Claude OAI-compat) all accept this shape.
        content: list[dict[str, Any]] = []
        if self.observation_type in ("screenshot", "screenshot_a11y_tree") and screenshot:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{base64.b64encode(screenshot).decode()}"
                    },
                }
            )
        prose = f"Instruction: {instruction}\n\n"
        if self.observation_type in ("a11y_tree", "screenshot_a11y_tree"):
            prose += f"Accessibility tree:\n{_format_a11y(a11y_tree)}\n\n"
        prose += "Emit the next pyautogui action(s) and a sentinel if appropriate."
        content.append({"type": "text", "text": prose})

        completion = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "system", "content": SYS_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        choice = completion.choices[0]
        raw = choice.message.content or ""
        # llama-swap thinking models stash the planning in reasoning_content
        # and may emit empty .content if max_tokens is starved. Surface it
        # so we can see why and so the parser still has something to chew.
        reasoning = getattr(choice.message, "reasoning_content", None) or ""
        if not raw and reasoning:
            raw = reasoning
        actions = _parse_response(raw)
        if not actions:
            actions = [FAIL]  # empty response = surface as failure, not silent stall

        info = {
            "raw": raw,
            "reasoning": reasoning,
            "model": self.model,
            "exec_mode": self.exec_mode,
            "finish_reason": choice.finish_reason,
            "input_tokens": completion.usage.prompt_tokens if completion.usage else None,
            "output_tokens": completion.usage.completion_tokens if completion.usage else None,
        }
        self.last_trace = AgentTrace(
            instruction=instruction,
            raw_response=raw,
            parsed_actions=actions,
            observation_summary={
                "has_screenshot": bool(screenshot),
                "a11y_chars": len(a11y_tree or ""),
            },
        )
        return info, actions
