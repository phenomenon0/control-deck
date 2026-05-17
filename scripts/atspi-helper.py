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


def _is_wayland() -> bool:
    """True when running under a Wayland compositor.

    AT-SPI's mouse-event synth path goes through XTest, which only exists on
    X11 — so we need to know whether to ask the portal for the click instead.
    """
    if (os.environ.get("XDG_SESSION_TYPE") or "").lower() == "wayland":
        return True
    return bool(os.environ.get("WAYLAND_DISPLAY"))


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

    The walk stops once cursor is the Application node, since we already
    pin the path to its name. Walking past the app picks up `-1` from
    Application.getIndexInParent() (Desktop is not a real index parent in
    AT-SPI), and previously bled the desktop role ("main") into the path.
    """
    try:
        app = node.getApplication()
        app_name = app.name if app else ""
    except Exception as exc:
        log.debug("_node_handle getApplication: %s", exc)
        app = None
        app_name = ""

    indices: list[str] = []
    cursor = node
    while cursor is not None:
        # Stop at the Application root. Two ways we recognise it:
        #   1. cursor IS the app object getApplication() returned (cheap & precise).
        #   2. cursor.parent is None (fallback for adapters that hide the link).
        if app is not None and cursor == app:
            break
        try:
            parent = cursor.parent
        except Exception as exc:
            log.debug("_node_handle cursor.parent: %s", exc)
            parent = None
        if parent is None:
            break
        try:
            idx = cursor.getIndexInParent()
        except Exception as exc:
            log.debug("_node_handle getIndexInParent: %s", exc)
            idx = -1
        if idx < 0:
            # Sibling search to recover the real index. Falls through to a
            # `?<name>` sentinel if name+role don't disambiguate; resolver
            # treats `?…` as a name-match request at that depth.
            idx = _find_child_index(parent, cursor)
            if idx < 0:
                indices.append(_name_sentinel(cursor))
                cursor = parent
                continue
        indices.append(str(idx))
        cursor = parent

    # Root segment is always the app name when known, so paths are stable
    # across runs ("org.gnome.Nautilus/0/3/0" rather than "main/-1/0/3/0").
    if app_name:
        indices.append(app_name)
    elif cursor is not None:
        try:
            indices.append(cursor.name or cursor.getRoleName())
        except Exception:
            indices.append("")

    path_str = "/".join(reversed(indices))
    handle_id = f"{app_name}::{path_str}"
    cache_entries[handle_id] = {"app": app_name, "path": path_str, "name": node.name}

    return {
        "id": handle_id,
        "role": node.getRoleName(),
        "name": node.name,
        "path": path_str,
    }


def _find_child_index(parent, target) -> int:
    """Linear scan parent's children for `target`. Returns -1 if not found."""
    try:
        count = parent.childCount
    except Exception as exc:
        log.debug("_find_child_index childCount: %s", exc)
        return -1
    for i in range(count):
        try:
            child = parent.getChildAtIndex(i)
        except Exception as exc:
            log.debug("_find_child_index getChildAtIndex(%d): %s", i, exc)
            continue
        if child == target:
            return i
    return -1


def _name_sentinel(node) -> str:
    """Sentinel `?<role>:<name>` for path segments that lack a stable index."""
    role = ""
    name = ""
    try:
        role = node.getRoleName() or ""
    except Exception:
        pass
    try:
        name = node.name or ""
    except Exception:
        pass
    return f"?{role}:{name}"


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


def _normalize_app(value: str) -> str:
    """Fold case + strip separators so {app:"google-chrome"}, {app:"Google Chrome"},
    and {app:"googlechrome"} all match an AT-SPI app named "Google Chrome".

    Also strips a leading "org." / "com." reverse-domain prefix and a trailing
    ".desktop" so {app:"org.telegram.desktop"} matches AT-SPI name "Telegram".
    """
    s = value.lower()
    for prefix in ("org.", "com.", "io.", "net."):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    if s.endswith(".desktop"):
        s = s[:-len(".desktop")]
    # Drop separators so hyphen/space/underscore/dot variants all collapse.
    return "".join(c for c in s if c.isalnum())


def _app_matches(query_app: str, accessible_app_name: str) -> bool:
    """True if `query_app` should match the AT-SPI app name.

    Tries exact substring (case-insensitive) first to preserve back-compat
    with the original behaviour, then falls back to normalized comparison
    for desktop-ID-style queries.
    """
    if not query_app:
        return True
    if query_app.lower() in (accessible_app_name or "").lower():
        return True
    nq = _normalize_app(query_app)
    na = _normalize_app(accessible_app_name or "")
    return bool(nq) and bool(na) and (nq in na or na in nq)


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
            if not a or not _app_matches(app, a.name or ""):
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
            if query.get("app") and not _app_matches(query["app"], app.name or ""):
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


def _resolve_named_child(parent, count: int, want_role: str, want_name: str):
    """Find a child by (role, name) when the original index is unrecoverable."""
    for i in range(count):
        try:
            child = parent.getChildAtIndex(i)
        except Exception as exc:
            log.debug("_resolve_named_child getChildAtIndex(%d): %s", i, exc)
            continue
        if child is None:
            continue
        try:
            role = child.getRoleName() or ""
        except Exception:
            role = ""
        try:
            name = child.name or ""
        except Exception:
            name = ""
        if role == want_role and name == want_name:
            return child
    return None


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
    app_name, sep, id_path = hid.partition("::")
    # Handles round-tripped via the CLI / external callers may carry only
    # `id`; the encoded path is the substring after "::". Use it when the
    # caller didn't break the handle apart for us.
    if not path_str and sep:
        path_str = id_path

    registry = pyatspi.Registry.getDesktop(0)

    def find_app():
        for i in range(registry.childCount):
            a = registry.getChildAtIndex(i)
            if a is None:
                continue
            if not app_name or app_name == (a.name or ""):
                return a
        return None

    # Path-based resolution: "<app_name>/<idx>/<idx>/..." with optional
    # `?<role>:<name>` segments where the helper couldn't determine the
    # child's index in its parent (and a sibling-scan failed to recover it).
    if path_str:
        parts = path_str.split("/")
        app = find_app()
        if app is None:
            return None
        cursor = app
        for seg in parts[1:]:
            if cursor is None:
                break
            try:
                count = cursor.childCount
            except Exception as exc:
                log.debug("_resolve_handle childCount at seg %r: %s", seg, exc)
                cursor = None
                break
            if seg.startswith("?"):
                want_role, _, want_name = seg[1:].partition(":")
                cursor = _resolve_named_child(cursor, count, want_role, want_name)
                continue
            try:
                idx = int(seg)
            except ValueError:
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

    # 3. Synthetic mouse click at component center.
    #    AT-SPI's generateMouseEvent goes through XTest, which is X11-only —
    #    on Wayland it silently no-ops. So on Wayland (or when XTest fails
    #    on X11), we hand the bounds back to the TS adapter so it can route
    #    through the xdg-desktop-portal RemoteDesktop click_pixel path
    #    instead. Same shape as the Windows host's "mouse-required" reply.
    try:
        comp = node.queryComponent()
        ext = comp.getExtents(pyatspi.DESKTOP_COORDS)
        if ext.width <= 0 or ext.height <= 0 or ext.x < 0 or ext.y < 0:
            return {"ok": False, "error": f"node off-screen or hidden (x={ext.x},y={ext.y},w={ext.width},h={ext.height})"}
        cx = ext.x + ext.width // 2
        cy = ext.y + ext.height // 2
        bounds = {"x": ext.x, "y": ext.y, "width": ext.width, "height": ext.height}

        if _is_wayland():
            return {"ok": True, "data": {"method": "mouse-required", "bounds": bounds, "x": cx, "y": cy, "reason": "wayland"}}

        try:
            pyatspi.Registry.generateMouseEvent(cx, cy, "b1c")
            return {"ok": True, "data": {"method": "mouse", "x": cx, "y": cy, "bounds": bounds}}
        except Exception as synth_err:
            # XTest broken on this X11 session — degrade to portal path.
            return {"ok": True, "data": {"method": "mouse-required", "bounds": bounds, "x": cx, "y": cy, "reason": f"xtest_failed: {synth_err}"}}
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


def _dispatch(cmd: dict[str, Any]) -> dict[str, Any]:
    op = cmd.get("op")
    try:
        if op == "available":
            return op_available()
        if op == "locate":
            return op_locate(cmd.get("query") or {})
        if op == "click":
            return op_click(cmd.get("handle") or {})
        if op == "type":
            return op_type(cmd.get("handle"), cmd.get("text") or "")
        if op == "tree":
            return op_tree(cmd.get("handle"))
        if op == "key":
            return op_key(cmd.get("key") or "")
        if op == "focus":
            return op_focus(cmd.get("handle") or {})
        return {"ok": False, "error": f"unknown op: {op}"}
    except Exception as e:
        return {"ok": False, "error": f"uncaught: {e}"}


# ---------------------------------------------------------------------------
#  Daemon mode — long-lived helper shared across all callers via a unix
#  socket at /tmp/control-deck-atspi-<uid>.sock. Pattern lifted from
#  browser-use/browser-harness (see docs/native-adapter): one daemon per
#  user, line-delimited JSON over connection-per-request, ping-based
#  liveness, pid+start-time identity to defeat PID reuse.
# ---------------------------------------------------------------------------

import socket
import socketserver
import threading

DAEMON_SOCK = os.path.join(tempfile.gettempdir(), f"control-deck-atspi-{os.getuid()}.sock")
DAEMON_PID_FILE = os.path.join(tempfile.gettempdir(), f"control-deck-atspi-{os.getuid()}.pid")
DAEMON_STARTED_AT = time.time()


def _write_pid_file() -> None:
    payload = {"pid": os.getpid(), "started_at": DAEMON_STARTED_AT, "socket": DAEMON_SOCK}
    tmp = DAEMON_PID_FILE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(payload, fh)
    os.replace(tmp, DAEMON_PID_FILE)


def _cleanup_daemon_files() -> None:
    for path in (DAEMON_SOCK, DAEMON_PID_FILE):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            log.warning("cleanup %s: %s", path, exc)


_shutdown_event = threading.Event()


class _Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        # rfile is a buffered stream; readline() returns b"" on EOF.
        for raw in self.rfile:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except Exception as e:
                self._reply({"ok": False, "error": f"bad input: {e}"})
                continue
            meta = cmd.get("meta")
            if meta == "ping":
                self._reply({"ok": True, "pong": True, "pid": os.getpid(), "started_at": DAEMON_STARTED_AT})
                continue
            if meta == "shutdown":
                self._reply({"ok": True})
                _shutdown_event.set()
                # Tickle the server so serve_forever wakes up promptly.
                try:
                    self.server.shutdown()
                except Exception as exc:
                    log.debug("server.shutdown signal: %s", exc)
                return
            req_id = cmd.get("id")
            result = _dispatch(cmd)
            if req_id is not None:
                result["id"] = req_id
            self._reply(result)

    def _reply(self, payload: dict[str, Any]) -> None:
        self.wfile.write((json.dumps(payload) + "\n").encode("utf-8"))
        self.wfile.flush()


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32


def _daemon_serve() -> int:
    """Bind the unix socket, serve until shutdown meta or signal."""
    # Pre-import pyatspi so the first real op doesn't pay the cold cost.
    try:
        _import_pyatspi()
    except Exception as exc:
        log.warning("daemon: pyatspi preload failed: %s", exc)

    # Stale socket from a crashed prior instance — remove if not in use.
    if os.path.exists(DAEMON_SOCK):
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.settimeout(0.2)
            probe.connect(DAEMON_SOCK)
            probe.close()
            print(json.dumps({"ok": False, "error": "another atspi-helper daemon already listening"}))
            return 1
        except OSError:
            try:
                os.unlink(DAEMON_SOCK)
            except OSError as exc:
                log.warning("removing stale socket %s: %s", DAEMON_SOCK, exc)
        finally:
            probe.close()

    server = _Server(DAEMON_SOCK, _Handler)
    try:
        os.chmod(DAEMON_SOCK, 0o600)
    except OSError as exc:
        log.warning("chmod %s 0600: %s", DAEMON_SOCK, exc)
    _write_pid_file()
    # Print a single line so callers waiting on stdout know we're up. They
    # can also poll the pid file / socket; this is just a fast path.
    print(json.dumps({"ok": True, "ready": True, "socket": DAEMON_SOCK, "pid": os.getpid()}), flush=True)

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        try:
            server.server_close()
        finally:
            _cleanup_daemon_files()
    return 0


def main() -> int:
    if "--daemon" in sys.argv[1:]:
        return _daemon_serve()

    try:
        cmd = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad input: {e}"}))
        return 0

    print(json.dumps(_dispatch(cmd)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
