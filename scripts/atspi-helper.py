#!/usr/bin/env python3
"""AT-SPI adapter helper for control-deck.

Reads a JSON command from stdin, writes a JSON result to stdout:

  {"op":"locate","query":{"name":"Files","role":"frame"}}
  -> {"ok":true,"data":[{"id":":1.42/17","name":"Files","role":"frame"}]}

  {"op":"click","handle":{"id":":1.42/17"}}
  -> {"ok":true}

  {"op":"available"}
  -> {"ok":true}

Handles are `"<bus_name>/<path_or_index>"` strings. Because AT-SPI re-
numbers objects on every query, we cache a minimal registry on-disk
under /tmp so repeated locate->click calls within a session stay valid.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from typing import Any

CACHE_PATH = os.path.join(tempfile.gettempdir(), f"control-deck-atspi-{os.getuid()}.json")
CACHE_TTL_SECONDS = 60


def _read_cache() -> dict[str, Any]:
    try:
        with open(CACHE_PATH) as fh:
            raw = json.load(fh)
        if time.time() - raw.get("ts", 0) > CACHE_TTL_SECONDS:
            return {"ts": time.time(), "entries": {}}
        return raw
    except Exception:
        return {"ts": time.time(), "entries": {}}


def _write_cache(cache: dict[str, Any]) -> None:
    try:
        with open(CACHE_PATH, "w") as fh:
            json.dump(cache, fh)
    except Exception:
        pass


def _import_pyatspi():
    try:
        import pyatspi  # type: ignore
        return pyatspi
    except ImportError as exc:
        raise RuntimeError(
            "pyatspi not installed (try: sudo dnf install python3-pyatspi "
            "or sudo apt install python3-pyatspi)"
        ) from exc


def _node_handle(node, cache_entries: dict[str, Any]) -> dict[str, Any]:
    """Build a stable-ish handle dict and cache the live object."""
    try:
        app = node.getApplication()
        app_name = app.name if app else ""
    except Exception:
        app_name = ""

    # Build a path via repeated parent() to produce a semi-stable id
    parts: list[str] = []
    cursor = node
    while cursor is not None:
        try:
            parent = cursor.parent
        except Exception:
            parent = None
        if parent is None:
            parts.append(cursor.name or cursor.getRoleName())
            break
        try:
            parts.append(str(parent.getIndexInParent() if hasattr(cursor, "getIndexInParent") else 0))
        except Exception:
            parts.append("?")
        cursor = parent

    path_str = "/".join(reversed(parts))
    handle_id = f"{app_name}::{path_str}"
    cache_entries[handle_id] = {"app": app_name, "path": path_str, "name": node.name}

    return {
        "id": handle_id,
        "role": node.getRoleName(),
        "name": node.name,
        "path": path_str,
    }


def _walk(root, max_nodes: int = 2000):
    """BFS walk over the accessibility tree."""
    queue = [root]
    seen = 0
    while queue and seen < max_nodes:
        node = queue.pop(0)
        yield node
        seen += 1
        try:
            for i in range(node.childCount):
                try:
                    queue.append(node.getChildAtIndex(i))
                except Exception:
                    continue
        except Exception:
            continue


def _match(node, query: dict[str, Any]) -> bool:
    name = query.get("name")
    role = query.get("role")
    app = query.get("app")

    if role:
        try:
            if role.lower() not in node.getRoleName().lower():
                return False
        except Exception:
            return False

    if name:
        try:
            if name.lower() not in (node.name or "").lower():
                return False
        except Exception:
            return False

    if app:
        try:
            a = node.getApplication()
            if not a or app.lower() not in (a.name or "").lower():
                return False
        except Exception:
            return False

    return True


def op_available() -> dict[str, Any]:
    try:
        _import_pyatspi()
        return {"ok": True, "data": {"ok": True}}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def op_locate(query: dict[str, Any]) -> dict[str, Any]:
    pyatspi = _import_pyatspi()
    cache = _read_cache()
    entries = cache.get("entries", {})
    limit = int(query.get("limit", 10))

    results: list[dict[str, Any]] = []
    try:
        registry = pyatspi.Registry.getDesktop(0)
        for app in registry:
            if query.get("app") and query["app"].lower() not in (app.name or "").lower():
                continue
            for node in _walk(app):
                if _match(node, query):
                    results.append(_node_handle(node, entries))
                    if len(results) >= limit:
                        break
            if len(results) >= limit:
                break
    except Exception as e:
        return {"ok": False, "error": f"locate: {e}"}

    cache["ts"] = time.time()
    cache["entries"] = entries
    _write_cache(cache)
    return {"ok": True, "data": results}


def _resolve_handle(handle: dict[str, Any]):
    """Re-walk the desktop to find a live node matching the cached handle."""
    pyatspi = _import_pyatspi()
    hid = handle.get("id", "")
    name = handle.get("name") or ""
    app_name, _, _ = hid.partition("::")

    registry = pyatspi.Registry.getDesktop(0)
    for app in registry:
        if app_name and app_name != (app.name or ""):
            continue
        for node in _walk(app):
            if node.name == name and name:
                return node
    return None


def op_click(handle: dict[str, Any]) -> dict[str, Any]:
    pyatspi = _import_pyatspi()
    node = _resolve_handle(handle)
    if node is None:
        return {"ok": False, "error": "node not found (stale handle)"}
    try:
        action = node.queryAction()
        for i in range(action.nActions):
            name = action.getName(i)
            if name.lower() in ("click", "press", "activate"):
                action.doAction(i)
                return {"ok": True}
        # fall back to first action
        if action.nActions > 0:
            action.doAction(0)
            return {"ok": True}
        return {"ok": False, "error": "node has no actions"}
    except Exception as e:
        return {"ok": False, "error": f"click: {e}"}


def op_type(handle: dict[str, Any] | None, text: str) -> dict[str, Any]:
    pyatspi = _import_pyatspi()
    if handle:
        node = _resolve_handle(handle)
        if node is None:
            return {"ok": False, "error": "node not found (stale handle)"}
        try:
            editable = node.queryEditableText()
            editable.insertText(editable.caretOffset, text, len(text))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": f"type: {e}"}
    # No handle: delegate to input-common (caller should use synthetic input)
    return {"ok": False, "error": "no handle supplied; use input-common for focused typing"}


def op_tree(handle: dict[str, Any] | None) -> dict[str, Any]:
    pyatspi = _import_pyatspi()
    cache = _read_cache()
    entries = cache.get("entries", {})

    try:
        if handle:
            root = _resolve_handle(handle)
            if root is None:
                return {"ok": False, "error": "root not found"}
        else:
            root = pyatspi.Registry.getDesktop(0)

        def build(node, depth=0):
            h = _node_handle(node, entries)
            children: list[dict[str, Any]] = []
            if depth < 6:
                try:
                    for i in range(min(node.childCount, 40)):
                        children.append(build(node.getChildAtIndex(i), depth + 1))
                except Exception:
                    pass
            return {"handle": h, "children": children}

        result = build(root)
        cache["ts"] = time.time()
        cache["entries"] = entries
        _write_cache(cache)
        return {"ok": True, "data": result}
    except Exception as e:
        return {"ok": False, "error": f"tree: {e}"}


def main() -> int:
    try:
        cmd = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad input: {e}"}))
        return 0

    op = cmd.get("op")
    try:
        if op == "available":
            result = op_available()
        elif op == "locate":
            result = op_locate(cmd.get("query") or {})
        elif op == "click":
            result = op_click(cmd.get("handle") or {})
        elif op == "type":
            result = op_type(cmd.get("handle"), cmd.get("text") or "")
        elif op == "tree":
            result = op_tree(cmd.get("handle"))
        else:
            result = {"ok": False, "error": f"unknown op: {op}"}
    except Exception as e:
        result = {"ok": False, "error": f"uncaught: {e}"}

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
