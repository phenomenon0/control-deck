#!/usr/bin/env python3
"""
One-shot ScreenCast portal capture helper.

Why this exists: dbus-next on Electron 41 / Node 24 SIGTRAPs when creating
a session-bus proxy object, so the equivalent TypeScript path is unusable.
Python's dbus-python stack works reliably and has no ABI headaches.

Flow (per-call):
  1. Read portal-screencast.token if it exists (silent subsequent grants).
  2. CreateSession + SelectSources + Start on
     org.freedesktop.portal.ScreenCast.
  3. OpenPipeWireRemote → FD pointing at the granted PipeWire stream.
  4. Spawn gst-launch-1.0 with fd=3 to pull one frame as PNG.
  5. Persist the new restore_token to the token path (rotates each call).
  6. Print a one-line JSON result on stdout.

Usage:
    screencast-capture.py <png-out-path> <token-path>

Output (stdout, single JSON line):
    {"ok": true, "path": "...", "width": N, "height": N}
    {"ok": false, "error": "message"}
"""
from __future__ import annotations

import json
import os
import random
import string
import struct
import subprocess
import sys
import threading

import dbus
import dbus.mainloop.glib
from gi.repository import GLib


BUS_NAME = "org.freedesktop.portal.Desktop"
OBJECT_PATH = "/org/freedesktop/portal/desktop"
SCREENCAST_IFACE = "org.freedesktop.portal.ScreenCast"
REQUEST_IFACE = "org.freedesktop.portal.Request"
SESSION_IFACE = "org.freedesktop.portal.Session"

SOURCE_TYPE_MONITOR = 1

START_TIMEOUT_SEC = 120  # first call may wait for user click on the dialog


def _token(prefix: str) -> str:
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=16))
    return f"{prefix}_{rand}"


def _sender_name(bus: dbus.SessionBus) -> str:
    return bus.get_unique_name().removeprefix(":").replace(".", "_")


def _request_path(sender: str, token: str) -> str:
    return f"/org/freedesktop/portal/desktop/request/{sender}/{token}"


class _ResponseWaiter:
    """Waits for the Response signal on a Request path."""

    def __init__(self, bus, path: str, loop: GLib.MainLoop):
        self.bus = bus
        self.path = path
        self.loop = loop
        self.result = None
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


def _run_request(bus, iface, method_name: str, sender: str, method_args: list,
                 options: dict, inject_token_key: str | None = None):
    handle_token = _token("req")
    options = dict(options)
    options["handle_token"] = handle_token
    if inject_token_key:
        # placeholder — caller already injected
        pass
    loop = GLib.MainLoop()
    waiter = _ResponseWaiter(bus, _request_path(sender, handle_token), loop)
    method = getattr(iface, method_name)
    method(*method_args, options)
    return waiter.wait()


def _png_dimensions(path: str) -> tuple[int, int]:
    with open(path, "rb") as f:
        header = f.read(24)
    if header[1:4] != b"PNG":
        raise RuntimeError("gst-launch produced a non-PNG file")
    width, height = struct.unpack(">II", header[16:24])
    return width, height


def _variant(value):
    """Unwrap dbus wrappers for JSON-friendly access (only used in debug)."""
    if hasattr(value, "real"):
        return int(value)
    return value


def capture(png_path: str, token_path: str) -> dict:
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    sender = _sender_name(bus)

    obj = bus.get_object(BUS_NAME, OBJECT_PATH)
    iface = dbus.Interface(obj, SCREENCAST_IFACE)

    existing_token = None
    if os.path.exists(token_path):
        try:
            with open(token_path, "r", encoding="utf-8") as f:
                existing_token = f.read().strip() or None
        except Exception:
            existing_token = None

    # 1. CreateSession
    session_token = _token("sess")
    code, results = _run_request(
        bus, iface, "CreateSession", sender, [],
        {"session_handle_token": session_token},
    )
    if code != 0:
        raise RuntimeError(f"CreateSession failed (code={code})")
    session_handle = str(results["session_handle"])

    try:
        # 2. SelectSources
        select_opts = {
            "types": dbus.UInt32(SOURCE_TYPE_MONITOR),
            "multiple": False,
            "persist_mode": dbus.UInt32(2),  # persistent across restarts
        }
        if existing_token:
            select_opts["restore_token"] = existing_token
        code, _results = _run_request(
            bus, iface, "SelectSources", sender, [session_handle], select_opts,
        )
        if code != 0:
            raise RuntimeError(f"SelectSources failed (code={code})")

        # 3. Start — first call shows the screen-share dialog. With a valid
        # restore_token, GNOME silently reuses the prior grant.
        code, results = _run_request(
            bus, iface, "Start", sender, [session_handle, ""], {},
        )
        if code != 0:
            raise RuntimeError(
                "user denied ScreenCast permission"
                if code == 1 else f"Start failed (code={code})"
            )

        # Persist new restore_token for next invocation.
        new_token = results.get("restore_token")
        if new_token:
            try:
                os.makedirs(os.path.dirname(token_path), exist_ok=True)
                with open(token_path, "w", encoding="utf-8") as f:
                    f.write(str(new_token))
            except Exception as exc:
                print(f"[screencast] warn: failed to save restore_token: {exc}",
                      file=sys.stderr)

        streams = results.get("streams", [])
        if not streams:
            raise RuntimeError("Start returned no streams")
        node_id = int(streams[0][0])

        # 4. OpenPipeWireRemote → FD owned by this process.
        fd_obj = iface.OpenPipeWireRemote(session_handle, {})
        fd = fd_obj.take() if hasattr(fd_obj, "take") else int(fd_obj)

        # 5. Spawn gst-launch. pipewiresrc expects `fd=3`, so dup2 the
        # portal fd to slot 3 in the child via preexec_fn. pass_fds alone
        # would keep the fd at its current number — which gst-launch can't
        # guess.
        def _child_setup():
            os.dup2(fd, 3)

        try:
            proc = subprocess.Popen(
                [
                    "gst-launch-1.0", "-q",
                    "pipewiresrc", "fd=3", f"path={node_id}",
                    "num-buffers=1",
                    "!", "videoconvert",
                    "!", "pngenc", "snapshot=true",
                    "!", "filesink", f"location={png_path}",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=(fd, 3),
                preexec_fn=_child_setup,
            )
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            _stdout, stderr = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            raise RuntimeError("gst-launch capture timed out")
        if proc.returncode != 0:
            raise RuntimeError(
                f"gst-launch exited {proc.returncode}: "
                f"{stderr.decode('utf-8', errors='replace').strip()}"
            )

        if not os.path.exists(png_path) or os.path.getsize(png_path) == 0:
            raise RuntimeError("gst-launch produced no output file")

        width, height = _png_dimensions(png_path)
        return {"ok": True, "path": png_path, "width": width, "height": height}

    finally:
        # Always tear down the session so xdg-desktop-portal can garbage-
        # collect the ScreenCast stream. The restore_token keeps the grant.
        try:
            sess = dbus.Interface(
                bus.get_object(BUS_NAME, session_handle), SESSION_IFACE,
            )
            sess.Close()
        except Exception:
            pass


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: screencast-capture.py <png-out-path> <token-path>",
              file=sys.stderr)
        return 2
    png_path = sys.argv[1]
    token_path = sys.argv[2]
    try:
        result = capture(png_path, token_path)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        return 1
    print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
