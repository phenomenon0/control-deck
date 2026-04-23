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
import logging
import os
import sys
import tempfile
import time
from typing import Any

log = logging.getLogger("atspi-helper")

CACHE_PATH = os.path.join(tempfile.gettempdir(), f"control-deck-atspi-{os.getuid()}.json")
CACHE_TTL_SECONDS = 60


def _read_cache() -> dict[str, Any]:
    try:
        with open(CACHE_PATH) as fh:
            raw = json.load(fh)
        if time.time() - raw.get("ts", 0) > CACHE_TTL_SECONDS:
            return {"ts": time.time(), "entries": {}}
        return raw
    except Exception as exc:
        log.debug("reading cache %s: %s", CACHE_PATH, exc)
        return {"ts": time.time(), "entries": {}}


def _write_cache(cache: dict[str, Any]) -> None:
    try:
        with open(CACHE_PATH, "w") as fh:
            json.dump(cache, fh)
    except Exception as exc:
        log.warning("writing cache %s: %s", CACHE_PATH, exc)


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
    """Build a stable-ish handle dict and cache the live object.

    Path format: "<app_name>/<idx_in_app>/<idx_in_frame>/...". Indices are
    each node's position in its own parent. The leaf is the node itself.
    """
    try:
        app = node.getApplication()
        app_name = app.name if app else ""
    except Exception as exc:
        log.debug("_node_handle getApplication: %s", exc)
        app_name = ""

    indices: list[str] = []
    cursor = node
    while cursor is not None:
        try:
            parent = cursor.parent
        except Exception as exc:
            log.debug("_node_handle cursor.parent: %s", exc)
            parent = None
        if parent is None:
            # Reached the application root.
            indices.append(cursor.name or cursor.getRoleName())
            break
        try:
            idx = cursor.getIndexInParent()
        except Exception as exc:
            log.debug("_node_handle getIndexInParent: %s", exc)
            idx = -1
        indices.append(str(idx))
        cursor = parent

    path_str = "/".join(reversed(indices))
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
                except Exception as exc:
                    log.debug("_walk getChildAtIndex(%d): %s", i, exc)
                    continue
        except Exception as exc:
            log.debug("_walk childCount on node: %s", exc)
            continue


def _match(node, query: dict[str, Any]) -> bool:
    name = query.get("name")
    role = query.get("role")
    app = query.get("app")

    if role:
        try:
            if role.lower() not in node.getRoleName().lower():
                return False
        except Exception as exc:
            log.debug("_match getRoleName: %s", exc)
            return False

    if name:
        try:
            if name.lower() not in (node.name or "").lower():
                return False
        except Exception as exc:
            log.debug("_match node.name: %s", exc)
            return False

    if app:
        try:
            a = node.getApplication()
            if not a or app.lower() not in (a.name or "").lower():
                return False
        except Exception as exc:
            log.debug("_match getApplication: %s", exc)
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
    """Re-walk the desktop to find a live node matching the cached handle.

    Preference order:
      1. Walk the recorded index path (most specific / survives empty names).
      2. Fall back to name match inside the target app.
    """
    pyatspi = _import_pyatspi()
    hid = handle.get("id", "")
    name = handle.get("name") or ""
    path_str = handle.get("path") or ""
    app_name, _, _ = hid.partition("::")

    registry = pyatspi.Registry.getDesktop(0)

    def find_app():
        for i in range(registry.childCount):
            a = registry.getChildAtIndex(i)
            if a is None:
                continue
            if not app_name or app_name == (a.name or ""):
                return a
        return None

    # Path-based resolution: "<app_name>/<idx>/<idx>/..."
    if path_str:
        parts = path_str.split("/")
        app = find_app()
        if app is None:
            return None
        cursor = app
        for seg in parts[1:]:
            try:
                idx = int(seg)
            except ValueError:
                cursor = None
                break
            if cursor is None:
                break
            try:
                count = cursor.childCount
            except Exception as exc:
                log.debug("_resolve_handle childCount at seg %r: %s", seg, exc)
                cursor = None
                break
            if idx < 0 or idx >= count:
                cursor = None
                break
            try:
                cursor = cursor.getChildAtIndex(idx)
            except Exception as exc:
                log.debug("_resolve_handle getChildAtIndex(%d): %s", idx, exc)
                cursor = None
                break
        if cursor is not None:
            return cursor

    # Name fallback
    for i in range(registry.childCount):
        app = registry.getChildAtIndex(i)
        if app is None:
            continue
        if app_name and app_name != (app.name or ""):
            continue
        for node in _walk(app):
            if node.name == name and name:
                return node
    return None


def op_click(handle: dict[str, Any]) -> dict[str, Any]:
    """Click cascade: Action.doAction → Component.grabFocus + Enter key →
    synthetic mouse click at component center.

    GTK4 list items advertise the Action interface but have nActions==0, so
    the action path doesn't work and we have to fall through. Chromium
    widgets usually respond to the key fallback; native toolkits that move
    focus correctly respond to grabFocus+Enter; as a last resort we generate
    a compositor-level mouse event via AT-SPI's DeviceEventController."""
    pyatspi = _import_pyatspi()
    node = _resolve_handle(handle)
    if node is None:
        return {"ok": False, "error": "node not found (stale handle)"}

    # 1. Action interface with a sensible action name
    try:
        action = node.queryAction()
        if action.nActions > 0:
            preferred = None
            for i in range(action.nActions):
                name = action.getName(i).lower()
                if name in ("click", "press", "activate", "jump", "open", "do default"):
                    preferred = i
                    break
            if preferred is None:
                preferred = 0
            try:
                action.doAction(preferred)
                return {"ok": True, "data": {"method": "action", "name": action.getName(preferred)}}
            except Exception as exc:
                log.warning("op_click doAction(%d): %s", preferred, exc)
                # fall through to focus/mouse fallbacks
    except Exception as exc:
        log.debug("op_click queryAction: %s", exc)

    # 2. grabFocus + synthetic Enter
    focus_ok = False
    try:
        comp = node.queryComponent()
        focus_ok = bool(comp.grabFocus())
    except Exception as exc:
        log.debug("op_click grabFocus: %s", exc)
    if focus_ok:
        try:
            pyatspi.Registry.generateKeyboardEvent(36, None, pyatspi.KEY_PRESSRELEASE)  # keycode 36 = Return
            return {"ok": True, "data": {"method": "focus+enter"}}
        except Exception as exc:
            log.warning("op_click generateKeyboardEvent (Enter): %s", exc)

    # 3. Synthetic mouse click at component center (compositor-level)
    try:
        comp = node.queryComponent()
        ext = comp.getExtents(pyatspi.DESKTOP_COORDS)
        cx = ext.x + ext.width // 2
        cy = ext.y + ext.height // 2
        if cx <= 0 or cy <= 0 or ext.width <= 0 or ext.height <= 0:
            return {"ok": False, "error": f"node off-screen or hidden (x={ext.x},y={ext.y},w={ext.width},h={ext.height})"}
        pyatspi.Registry.generateMouseEvent(cx, cy, "b1c")
        return {"ok": True, "data": {"method": "mouse", "x": cx, "y": cy}}
    except Exception as e:
        return {"ok": False, "error": f"click: all fallbacks failed ({e})"}


# X11 keysym table — just the keys we actually need. Extend on demand.
# Values from /usr/include/X11/keysymdef.h; pyatspi accepts keycodes via XTEST,
# and keysyms via Atspi.generate_keyboard_event with KEY_SYM.
_KEYSYMS: dict[str, int] = {
    "return": 0xFF0D,
    "enter": 0xFF0D,
    "tab": 0xFF09,
    "escape": 0xFF1B,
    "backspace": 0xFF08,
    "delete": 0xFFFF,
    "space": 0x0020,
    "up": 0xFF52,
    "down": 0xFF54,
    "left": 0xFF51,
    "right": 0xFF53,
    "home": 0xFF50,
    "end": 0xFF57,
    "pageup": 0xFF55,
    "pagedown": 0xFF56,
    "f1": 0xFFBE, "f2": 0xFFBF, "f3": 0xFFC0, "f4": 0xFFC1,
    "f5": 0xFFC2, "f6": 0xFFC3, "f7": 0xFFC4, "f8": 0xFFC5,
    "f9": 0xFFC6, "f10": 0xFFC7, "f11": 0xFFC8, "f12": 0xFFC9,
    "menu": 0xFF67,
}

_MODIFIER_KEYSYMS: dict[str, int] = {
    "shift": 0xFFE1,
    "ctrl": 0xFFE3,
    "control": 0xFFE3,
    "alt": 0xFFE9,
    "super": 0xFFEB,
    "meta": 0xFFE7,
}


def _parse_key(spec: str) -> tuple[list[int], int]:
    """Split "Ctrl+Shift+Tab" into (modifier_keysyms, primary_keysym)."""
    parts = [p.strip() for p in spec.split("+") if p.strip()]
    if not parts:
        raise ValueError(f"empty key spec: {spec!r}")
    primary = parts[-1]
    modifiers = [_MODIFIER_KEYSYMS[p.lower()] for p in parts[:-1] if p.lower() in _MODIFIER_KEYSYMS]
    key_lower = primary.lower()
    if key_lower in _KEYSYMS:
        ks = _KEYSYMS[key_lower]
    elif len(primary) == 1:
        ks = ord(primary)
    else:
        raise ValueError(f"unknown key {primary!r}")
    return modifiers, ks


def op_key(spec: str) -> dict[str, Any]:
    """Send a keystroke or combo to the currently focused widget.

    Values in _KEYSYMS / _MODIFIER_KEYSYMS / ord(char) are X11 keysyms, so we
    must use pyatspi.KEY_SYM (not KEY_PRESSRELEASE, which treats the value as
    a keycode and silently sends a garbled event for values > 255).
    """
    pyatspi = _import_pyatspi()
    try:
        modifiers, primary = _parse_key(spec)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    try:
        for mod in modifiers:
            pyatspi.Registry.generateKeyboardEvent(mod, None, pyatspi.KEY_PRESS)
        pyatspi.Registry.generateKeyboardEvent(primary, None, pyatspi.KEY_SYM)
        for mod in reversed(modifiers):
            pyatspi.Registry.generateKeyboardEvent(mod, None, pyatspi.KEY_RELEASE)
        return {"ok": True, "data": {"spec": spec, "keysym": primary, "modifiers": modifiers}}
    except Exception as e:
        for mod in reversed(modifiers):
            try:
                pyatspi.Registry.generateKeyboardEvent(mod, None, pyatspi.KEY_RELEASE)
            except Exception as exc:
                log.warning("releasing modifier keysym 0x%x during key teardown: %s", mod, exc)
        return {"ok": False, "error": f"key: {e}"}


def op_focus(handle: dict[str, Any]) -> dict[str, Any]:
    """grabFocus on the node; returns True / False / error if unsupported."""
    node = _resolve_handle(handle)
    if node is None:
        return {"ok": False, "error": "node not found (stale handle)"}
    try:
        comp = node.queryComponent()
    except Exception as e:
        return {"ok": False, "error": f"focus: no Component interface ({e})"}
    try:
        result = bool(comp.grabFocus())
        return {"ok": True, "data": {"focused": result}}
    except Exception as e:
        return {"ok": False, "error": f"focus: {e}"}


def op_type(handle: dict[str, Any] | None, text: str) -> dict[str, Any]:
    """Type into a widget via EditableText, or into the focused window via
    KEY_STRING synthesis when no handle is given / EditableText is unavailable.

    Qt apps (and Electron under --force-renderer-accessibility) often do not
    expose EditableText on their search bars. The KEY_STRING fallback routes
    through AT-SPI's DeviceEventController, which feeds XTest / Wayland
    input-method injection depending on session type.
    """
    pyatspi = _import_pyatspi()

    def _key_string(s: str) -> dict[str, Any]:
        try:
            pyatspi.Registry.generateKeyboardEvent(0, s, pyatspi.KEY_STRING)
            return {"ok": True, "data": {"method": "key_string", "len": len(s)}}
        except Exception as e:
            return {"ok": False, "error": f"type: key_string failed ({e})"}

    if handle:
        node = _resolve_handle(handle)
        if node is None:
            return {"ok": False, "error": "node not found (stale handle)"}
        try:
            editable = node.queryEditableText()
            editable.insertText(editable.caretOffset, text, len(text))
            return {"ok": True, "data": {"method": "editable_text"}}
        except Exception as exc:
            # EditableText not supported (common on Qt search bars). Fall
            # through to KEY_STRING — whatever the user has focused on-screen
            # receives the characters.
            log.debug("op_type queryEditableText (falling back to key_string): %s", exc)
            return _key_string(text)
    return _key_string(text)


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
                except Exception as exc:
                    log.debug("op_tree build children at depth %d: %s", depth, exc)
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
        elif op == "key":
            result = op_key(cmd.get("key") or "")
        elif op == "focus":
            result = op_focus(cmd.get("handle") or {})
        else:
            result = {"ok": False, "error": f"unknown op: {op}"}
    except Exception as e:
        result = {"ok": False, "error": f"uncaught: {e}"}

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
