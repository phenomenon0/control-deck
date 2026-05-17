#!/usr/bin/env python3
"""
Tests for ControlDeckAgent response parsing.

These pin the OSWorld contract assumptions: the agent's predict() must
return a list of pyautogui code strings or DONE/WAIT/FAIL sentinels in
the order the model emitted them. Run:

    python3 -m pytest benchmarks/osworld/test_parse.py -v
"""
from __future__ import annotations

from control_deck_agent import _parse_response, _autoprefix_pyautogui, DONE, WAIT, FAIL


def test_single_code_block():
    out = _parse_response("```python\npyautogui.click(100, 200)\n```")
    assert out == ["pyautogui.click(100, 200)"]


def test_code_block_without_language_hint():
    out = _parse_response("```\npyautogui.write('hi')\n```")
    assert out == ["pyautogui.write('hi')"]


def test_multiple_blocks_preserve_order():
    text = (
        "First focus then type.\n"
        "```python\npyautogui.click(50, 50)\n```\n"
        "Now type:\n"
        "```python\npyautogui.write('hello')\n```\n"
    )
    out = _parse_response(text)
    assert out == ["pyautogui.click(50, 50)", "pyautogui.write('hello')"]


def test_done_after_code_block():
    text = "```python\npyautogui.press('enter')\n```\nDONE"
    out = _parse_response(text)
    assert out == ["pyautogui.press('enter')", DONE]


def test_done_alone():
    # Task already completed by previous step.
    assert _parse_response("DONE") == [DONE]


def test_wait_alone():
    assert _parse_response("Page still loading. WAIT") == [WAIT]


def test_fail_with_reason():
    assert _parse_response("FAIL — captcha appeared") == [FAIL]


def test_sentinel_before_code_runs_first():
    # Edge case: shouldn't really happen, but the parser must not silently
    # drop a sentinel that appears before code.
    text = "WAIT\n```python\npyautogui.click(0, 0)\n```"
    out = _parse_response(text)
    assert out == [WAIT, "pyautogui.click(0, 0)"]


def test_sentinel_inside_code_block_ignored():
    # The word "DONE" appearing inside a python comment must not be
    # interpreted as the sentinel.
    text = "```python\n# all DONE here\npyautogui.click(1, 1)\n```"
    out = _parse_response(text)
    assert out == ["# all DONE here\npyautogui.click(1, 1)"]


def test_empty_text_returns_empty_list():
    # The agent treats this as failure at a higher level (predict() injects
    # FAIL); the parser itself is honest about emptiness.
    assert _parse_response("") == []


def test_prose_only_no_action():
    assert _parse_response("I would click somewhere but I'm thinking.") == []


def test_autoprefix_bare_click():
    # Bare `click(...)` is the most common model failure mode — must be
    # rewritten before it hits OSWorld's exec().
    out = _parse_response("```python\nclick(140, 200)\n```")
    assert out == ["pyautogui.click(140, 200)"]


def test_autoprefix_leaves_qualified_calls_alone():
    out = _parse_response("```python\npyautogui.click(140, 200)\n```")
    assert out == ["pyautogui.click(140, 200)"]


def test_autoprefix_mixed_block():
    # Mixed bare + qualified within the same block, plus an import.
    text = (
        "```python\n"
        "import subprocess\n"
        "subprocess.Popen(['nautilus', 'trash:///'])\n"
        "hotkey('ctrl', 'l')\n"
        "pyautogui.write('hello')\n"
        "press('enter')\n"
        "```"
    )
    out = _parse_response(text)
    assert out == [
        "import subprocess\n"
        "subprocess.Popen(['nautilus', 'trash:///'])\n"
        "pyautogui.hotkey('ctrl', 'l')\n"
        "pyautogui.write('hello')\n"
        "pyautogui.press('enter')"
    ]


def test_autoprefix_string_literal_not_rewritten():
    # The word "click(" appearing inside a string must NOT be rewritten —
    # only line-start call sites are targets of the shim.
    code = 'pyautogui.write("please click(here)")'
    assert _autoprefix_pyautogui(code) == code


def test_autoprefix_indented_call():
    # `if condition:` block with an indented bare call — the indent must be
    # preserved when the prefix is inserted.
    code = "if True:\n    click(10, 20)"
    assert _autoprefix_pyautogui(code) == "if True:\n    pyautogui.click(10, 20)"


if __name__ == "__main__":
    import sys
    import traceback

    failures = 0
    for name, fn in list(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  ok  {name}")
        except Exception:
            failures += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
