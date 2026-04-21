#!/usr/bin/env python3
"""Long-lived xdg-desktop-portal RemoteDesktop daemon.

Replaces electron/services/remote-desktop.ts, which is broken on Electron 41
/ Node 24 because dbus-next hangs at bus.getProxyObject() inside the main
process. We reuse the dbus-python + GLib pattern already proven in
scripts/screencast-capture.py.

Lifecycle
---------
* Started once per Electron launch with `--socket <path>` and `--token-dir <dir>`.
* Opens a keyboard-only RemoteDesktop session eagerly (portal prompt #1).
* Opens a combined RemoteDesktop+ScreenCast session lazily on first
  click_pixel request (portal prompt #2 -- the pointer session can't
  persist on GNOME so this prompts every launch).
* Persists a restore_token per session type under <token-dir>, so the
  keyboard-only prompt stops appearing after the first grant.
* Polls os.getppid() every 2 seconds and exits cleanly if the Electron
  parent is reaped.

Protocol
--------
Unix-domain stream socket, line-delimited JSON (request + "\n", then
response + "\n"). Exactly one in-flight request per connection.

Supported requests:
  {"op":"status"}
    -> {"ok":true,"keyboard_ready":bool,"pointer_ready":bool}

  {"op":"key","modifiers":[int,...],"keysym":int}
    -> {"ok":true}  (or {"ok":false,"error":"..."})

  {"op":"type","text":"hello world"}
    -> {"ok":true,"len":11}

  {"op":"click_pixel","x":100,"y":200,"button":"left"}
    -> {"ok":true,"x":100,"y":200}
"""
from __future__ import annotations

import argparse
import json
import os
import random
import socket
import socketserver
import string
import struct
import sys
import threading
import time

import dbus
import dbus.mainloop.glib
from gi.repository import GLib


BUS_NAME = "org.freedesktop.portal.Desktop"
OBJECT_PATH = "/org/freedesktop/portal/desktop"
REMOTE_IFACE = "org.freedesktop.portal.RemoteDesktop"
SCREENCAST_IFACE = "org.freedesktop.portal.ScreenCast"
REQUEST_IFACE = "org.freedesktop.portal.Request"
SESSION_IFACE = "org.freedesktop.portal.Session"

DEVICE_KEYBOARD = 1
DEVICE_POINTER = 2
SOURCE_TYPE_MONITOR = 1

KEY_PRESSED = 1
KEY_RELEASED = 0

# Linux input-event-codes.h pointer buttons
BTN_LEFT = 0x110
BTN_RIGHT = 0x111
BTN_MIDDLE = 0x112
BUTTONS = {"left": BTN_LEFT, "right": BTN_RIGHT, "middle": BTN_MIDDLE}

# X11 keysym for Shift_L, matching electron/services/remote-desktop.ts:465
KEYSYM_SHIFT = 0xFFE1

START_TIMEOUT_SEC = 120


def _token(prefix: str) -> str:
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=16))
    return f"{prefix}_{rand}"


def _sender_name(bus: dbus.SessionBus) -> str:
    return bus.get_unique_name().removeprefix(":").replace(".", "_")


def _request_path(sender: str, token: str) -> str:
    return f"/org/freedesktop/portal/desktop/request/{sender}/{token}"


class _ResponseWaiter:
    """Copy of the waiter from screencast-capture.py -- blocks the current
    thread on a portal Request.Response signal. Must be invoked while a
    GLib.MainLoop is running on the same thread."""

    def __init__(self, bus: dbus.SessionBus, path: str, loop: GLib.MainLoop):
        self.bus = bus
        self.path = path
        self.loop = loop
        self.result: tuple[int, dict] | None = None
        self._match = bus.add_signal_receiver(
            self._on_response,
            signal_name="Response",
            dbus_interface=REQUEST_IFACE,
            path=path,
        )
        self._timer = GLib.timeout_add_seconds(START_TIMEOUT_SEC, self._on_timeout)

    def _on_response(self, code, results):
        self.result = (int(code), dict(results))
        self._cleanup()

    def _on_timeout(self):
        self.result = (-1, {"__timeout__": True})
        self._cleanup()
        return False

    def _cleanup(self):
        try:
            self._match.remove()
        except Exception:
            pass
        try:
            GLib.source_remove(self._timer)
        except Exception:
            pass
        self.loop.quit()

    def wait(self):
        self.loop.run()
        if self.result is None:
            raise RuntimeError("portal response never arrived")
        code, results = self.result
        if results.get("__timeout__"):
            raise RuntimeError(f"portal request timed out at {self.path}")
        return code, results


def _run_request(bus, iface, method: str, sender: str, method_args: list, options: dict):
    handle_token = _token("req")
    options = dict(options)
    options["handle_token"] = handle_token
    loop = GLib.MainLoop()
    waiter = _ResponseWaiter(bus, _request_path(sender, handle_token), loop)
    getattr(iface, method)(*method_args, options)
    return waiter.wait()


def _read_token(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            t = f.read().strip()
        return t or None
    except Exception:
        return None


def _write_token(path: str, token: str) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(token)
        os.chmod(path, 0o600)
    except Exception as exc:
        print(f"[remote-desktop] warn: failed to persist token: {exc}", file=sys.stderr)


class PortalLock:
    """Serializes all portal / D-Bus calls on a single worker thread so GLib
    mainloops don't recurse. dbus-python itself is re-entrant, but layering
    two waiters on top of one another deadlocks."""

    def __init__(self):
        self._lock = threading.Lock()

    def __enter__(self):
        self._lock.acquire()
        return self

    def __exit__(self, *exc):
        self._lock.release()


class KeyboardSession:
    """Keyboard-only RemoteDesktop session. Persists across launches via
    restore_token -- the first-run prompt is the only UX tax."""

    def __init__(self, bus, sender: str, token_path: str):
        self.bus = bus
        self.sender = sender
        self.token_path = token_path
        self.handle: str | None = None
        self.iface = None

    def start(self) -> None:
        obj = self.bus.get_object(BUS_NAME, OBJECT_PATH)
        self.iface = dbus.Interface(obj, REMOTE_IFACE)

        session_token = _token("sess")
        code, results = _run_request(
            self.bus, self.iface, "CreateSession", self.sender, [],
            {"session_handle_token": session_token},
        )
        if code != 0:
            raise RuntimeError(f"CreateSession failed (code={code})")
        self.handle = str(results["session_handle"])

        select_opts = {
            "types": dbus.UInt32(DEVICE_KEYBOARD | DEVICE_POINTER),
            # 2 = persistent across restarts. Keyboard-only sessions accept
            # this; combined RD+SC sessions reject it on GNOME (see pointer
            # class below).
            "persist_mode": dbus.UInt32(2),
        }
        existing = _read_token(self.token_path)
        if existing:
            select_opts["restore_token"] = existing
        code, _ = _run_request(
            self.bus, self.iface, "SelectDevices", self.sender, [self.handle], select_opts,
        )
        if code != 0:
            raise RuntimeError(f"SelectDevices failed (code={code})")

        code, results = _run_request(
            self.bus, self.iface, "Start", self.sender, [self.handle, ""], {},
        )
        if code != 0:
            raise RuntimeError(
                "user denied RemoteDesktop permission"
                if code == 1 else f"Start failed (code={code})"
            )
        new_token = results.get("restore_token")
        if new_token:
            _write_token(self.token_path, str(new_token))

    def notify_key(self, keysym: int, state: int) -> None:
        if self.iface is None or self.handle is None:
            raise RuntimeError("keyboard session not started")
        self.iface.NotifyKeyboardKeysym(self.handle, {}, dbus.Int32(keysym), dbus.UInt32(state))

    def send_key_combo(self, modifiers: list[int], primary: int) -> None:
        for m in modifiers:
            self.notify_key(m, KEY_PRESSED)
        try:
            self.notify_key(primary, KEY_PRESSED)
            self.notify_key(primary, KEY_RELEASED)
        finally:
            for m in reversed(modifiers):
                try:
                    self.notify_key(m, KEY_RELEASED)
                except Exception:
                    pass

    def type_string(self, text: str) -> None:
        for ch in text:
            code = ord(ch)
            if code < 0x20 or code == 0x7F:
                continue
            keysym = code if code <= 0xFF else 0x01000000 + code
            needs_shift = "A" <= ch <= "Z"
            if needs_shift:
                self.send_key_combo([KEYSYM_SHIFT], keysym)
            else:
                self.notify_key(keysym, KEY_PRESSED)
                self.notify_key(keysym, KEY_RELEASED)

    def close(self) -> None:
        if self.handle is None:
            return
        try:
            sess = dbus.Interface(self.bus.get_object(BUS_NAME, self.handle), SESSION_IFACE)
            sess.Close()
        except Exception:
            pass
        self.handle = None


class PointerSession:
    """Combined RemoteDesktop + ScreenCast session for pixel-coord clicks.
    GNOME rejects persist_mode on combined sessions ("Remote desktop
    sessions cannot persist"), so this prompts once per Electron launch."""

    def __init__(self, bus, sender: str):
        self.bus = bus
        self.sender = sender
        self.handle: str | None = None
        self.iface = None
        self.stream_node_id: int | None = None

    def start(self) -> None:
        obj = self.bus.get_object(BUS_NAME, OBJECT_PATH)
        self.iface = dbus.Interface(obj, REMOTE_IFACE)
        sc_iface = dbus.Interface(obj, SCREENCAST_IFACE)

        session_token = _token("sess")
        code, results = _run_request(
            self.bus, self.iface, "CreateSession", self.sender, [],
            {"session_handle_token": session_token},
        )
        if code != 0:
            raise RuntimeError(f"CreateSession failed (code={code})")
        self.handle = str(results["session_handle"])

        code, _ = _run_request(
            self.bus, self.iface, "SelectDevices", self.sender, [self.handle],
            {
                "types": dbus.UInt32(DEVICE_KEYBOARD | DEVICE_POINTER),
                "persist_mode": dbus.UInt32(0),  # combined sessions can't persist
            },
        )
        if code != 0:
            raise RuntimeError(f"SelectDevices failed (code={code})")

        code, _ = _run_request(
            self.bus, sc_iface, "SelectSources", self.sender, [self.handle],
            {
                "types": dbus.UInt32(SOURCE_TYPE_MONITOR),
                "multiple": False,
                "persist_mode": dbus.UInt32(0),
            },
        )
        if code != 0:
            raise RuntimeError(f"SelectSources failed (code={code})")

        code, results = _run_request(
            self.bus, self.iface, "Start", self.sender, [self.handle, ""], {},
        )
        if code != 0:
            raise RuntimeError(
                "user denied RemoteDesktop+ScreenCast permission"
                if code == 1 else f"Start failed (code={code})"
            )
        streams = results.get("streams", [])
        if not streams:
            raise RuntimeError("Start returned no streams")
        self.stream_node_id = int(streams[0][0])

    def click_pixel(self, x: float, y: float, button: str) -> None:
        if self.iface is None or self.handle is None or self.stream_node_id is None:
            raise RuntimeError("pointer session not ready")
        btn = BUTTONS.get(button)
        if btn is None:
            raise RuntimeError(f"unknown button {button}")
        self.iface.NotifyPointerMotionAbsolute(
            self.handle, {}, dbus.UInt32(self.stream_node_id),
            dbus.Double(x), dbus.Double(y),
        )
        self.iface.NotifyPointerButton(self.handle, {}, dbus.Int32(btn), dbus.UInt32(1))
        self.iface.NotifyPointerButton(self.handle, {}, dbus.Int32(btn), dbus.UInt32(0))

    def close(self) -> None:
        if self.handle is None:
            return
        try:
            sess = dbus.Interface(self.bus.get_object(BUS_NAME, self.handle), SESSION_IFACE)
            sess.Close()
        except Exception:
            pass
        self.handle = None


class Daemon:
    def __init__(self, socket_path: str, token_dir: str):
        self.socket_path = socket_path
        self.token_dir = token_dir
        self.bus: dbus.SessionBus | None = None
        self.sender = ""
        self.keyboard: KeyboardSession | None = None
        self.pointer: PointerSession | None = None
        self.portal_lock = PortalLock()

    def init_bus(self) -> None:
        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        self.bus = dbus.SessionBus()
        self.sender = _sender_name(self.bus)

    def ensure_keyboard(self) -> KeyboardSession:
        if self.keyboard is None:
            assert self.bus is not None
            token_path = os.path.join(self.token_dir, "portal-restore.token")
            sess = KeyboardSession(self.bus, self.sender, token_path)
            sess.start()
            self.keyboard = sess
        return self.keyboard

    def ensure_pointer(self) -> PointerSession:
        if self.pointer is None:
            assert self.bus is not None
            sess = PointerSession(self.bus, self.sender)
            sess.start()
            self.pointer = sess
        return self.pointer

    def handle_request(self, req: dict) -> dict:
        op = req.get("op")
        if op == "status":
            return {
                "ok": True,
                "keyboard_ready": self.keyboard is not None,
                "pointer_ready": self.pointer is not None,
            }
        if op == "key":
            keysym = int(req["keysym"])
            modifiers = [int(m) for m in req.get("modifiers", [])]
            with self.portal_lock:
                self.ensure_keyboard().send_key_combo(modifiers, keysym)
            return {"ok": True}
        if op == "type":
            text = str(req["text"])
            with self.portal_lock:
                self.ensure_keyboard().type_string(text)
            return {"ok": True, "len": len(text)}
        if op == "click_pixel":
            x = float(req["x"])
            y = float(req["y"])
            button = str(req.get("button", "left"))
            with self.portal_lock:
                self.ensure_pointer().click_pixel(x, y, button)
            return {"ok": True, "x": x, "y": y}
        return {"ok": False, "error": f"unknown op {op!r}"}

    def close(self) -> None:
        if self.keyboard:
            self.keyboard.close()
        if self.pointer:
            self.pointer.close()


def _parent_watchdog(original_ppid: int, daemon: Daemon, server: socketserver.UnixStreamServer):
    while True:
        time.sleep(2)
        if os.getppid() != original_ppid:
            print("[remote-desktop] parent went away, shutting down", file=sys.stderr)
            try:
                server.shutdown()
            except Exception:
                pass
            try:
                daemon.close()
            except Exception:
                pass
            os._exit(0)


def _make_handler(daemon: Daemon):
    class _Handler(socketserver.StreamRequestHandler):
        def handle(self_inner):
            f_in = self_inner.rfile
            f_out = self_inner.wfile
            while True:
                line = f_in.readline()
                if not line:
                    return
                try:
                    req = json.loads(line.decode("utf-8"))
                except Exception as exc:
                    out = {"ok": False, "error": f"invalid json: {exc}"}
                else:
                    try:
                        out = daemon.handle_request(req)
                    except Exception as exc:
                        out = {"ok": False, "error": str(exc)}
                try:
                    f_out.write((json.dumps(out) + "\n").encode("utf-8"))
                    f_out.flush()
                except BrokenPipeError:
                    return
    return _Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True, help="Unix socket path")
    parser.add_argument("--token-dir", required=True, help="Dir to store restore_tokens")
    parser.add_argument("--eager-keyboard", action="store_true",
                        help="Init keyboard session at startup (default: lazy)")
    args = parser.parse_args()

    # Remove stale socket left from a previous run.
    if os.path.exists(args.socket):
        try:
            os.unlink(args.socket)
        except OSError:
            pass
    os.makedirs(os.path.dirname(args.socket) or ".", exist_ok=True)
    os.makedirs(args.token_dir, exist_ok=True)

    daemon = Daemon(args.socket, args.token_dir)
    try:
        daemon.init_bus()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bus init failed: {exc}"}), flush=True)
        return 1

    if args.eager_keyboard:
        try:
            with daemon.portal_lock:
                daemon.ensure_keyboard()
        except Exception as exc:
            # Soft-fail: let the first key/type request surface the error.
            print(f"[remote-desktop] eager keyboard init failed: {exc}", file=sys.stderr)

    class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True
        allow_reuse_address = True

    server = _Server(args.socket, _make_handler(daemon))
    os.chmod(args.socket, 0o600)

    # Ready handshake on stdout so the parent can await readiness.
    print(json.dumps({"ok": True, "socket": args.socket}), flush=True)

    original_ppid = os.getppid()
    t = threading.Thread(target=_parent_watchdog, args=(original_ppid, daemon, server), daemon=True)
    t.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.unlink(args.socket)
        except OSError:
            pass
        daemon.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
