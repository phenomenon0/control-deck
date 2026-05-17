#!/usr/bin/env python3
"""
One-shot xdg-desktop-portal Screenshot helper.

Why this exists: dbus-next on Electron 41 / Node 24 SIGTRAPs when creating
a session-bus proxy object, so the equivalent TypeScript path is unusable.
Python's dbus-python stack works reliably and has no ABI headaches.

Flow (per-call):
  1. CreateSession-less Screenshot call on
     org.freedesktop.portal.Screenshot — single Request round-trip.
  2. Await Response signal on the Request object path.
  3. On code=0, move the returned URI into the caller-specified path
     (portal writes its own temp file).
  4. Print a one-line JSON result on stdout.

`interactive=True` means the portal shows its confirm UI on first run and
silently returns on subsequent runs (GNOME stores the grant per-app).

Usage:
    screenshot-capture.py <png-out-path>

Output (stdout, single JSON line):
    {"ok": true, "path": "...", "width": N, "height": N}
    {"ok": false, "error": "message"}
"""
from __future__ import annotations

import json
import os
import random
import shutil
import string
import struct
import sys
import threading
from urllib.parse import unquote, urlparse

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

BUS = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
SCREENSHOT_IFACE = "org.freedesktop.portal.Screenshot"
REQUEST_IFACE = "org.freedesktop.portal.Request"
GNOME_SHELL_SCREENSHOT_BUS = "org.gnome.Shell.Screenshot"
GNOME_SHELL_SCREENSHOT_PATH = "/org/gnome/Shell/Screenshot"
GNOME_SHELL_SCREENSHOT_IFACE = "org.gnome.Shell.Screenshot"

CAPTURE_TIMEOUT_S = 120


def _random_token() -> str:
    return "cd_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=16))


def _sender_name(bus: dbus.SessionBus) -> str:
    return bus.get_unique_name().lstrip(":").replace(".", "_")


def _read_png_dims(path: str) -> tuple[int, int]:
    with open(path, "rb") as fh:
        header = fh.read(24)
    if len(header) < 24 or header[1:4] != b"PNG":
        raise ValueError(f"not a PNG: {path}")
    width = struct.unpack(">I", header[16:20])[0]
    height = struct.unpack(">I", header[20:24])[0]
    return width, height


def _path_from_uri_or_path(uri_or_path: str) -> str:
    return (
        unquote(urlparse(uri_or_path).path)
        if uri_or_path.startswith("file://")
        else uri_or_path
    )


def _result_for_existing_png(path: str) -> dict:
    try:
        width, height = _read_png_dims(path)
    except (OSError, ValueError) as err:
        return {"ok": False, "error": f"failed to read PNG dims: {err}"}
    return {"ok": True, "path": path, "width": width, "height": height}


def capture_via_gnome_shell(out_png: str) -> dict:
    """Fallback for GNOME Shell when xdg-desktop-portal is misconfigured.

    Fedora/GNOME sessions can end up with xdg-desktop-portal selecting the
    GNOME backend while the backend exposes only Settings (for example when
    GDK_BACKEND is imported into the systemd user manager). The public portal
    then returns Response code 2 for Screenshot even though GNOME Shell itself
    can still capture the desktop. Use GNOME Shell's private DBus screenshot
    interface as a local-session fallback rather than asking users to restart
    or reconfigure their whole portal stack.
    """
    try:
        bus = dbus.SessionBus()
        proxy = bus.get_object(GNOME_SHELL_SCREENSHOT_BUS, GNOME_SHELL_SCREENSHOT_PATH)
        iface = dbus.Interface(proxy, GNOME_SHELL_SCREENSHOT_IFACE)
        success, filename_used = iface.Screenshot(True, False, out_png)
    except dbus.DBusException as err:
        return {"ok": False, "error": f"GNOME Shell screenshot fallback failed: {err}"}
    except Exception as err:
        return {
            "ok": False,
            "error": f"GNOME Shell screenshot fallback failed: {type(err).__name__}: {err}",
        }

    if not bool(success):
        return {"ok": False, "error": "GNOME Shell screenshot fallback reported failure"}

    shot_path = _path_from_uri_or_path(str(filename_used or out_png))
    if not os.path.exists(shot_path):
        return {"ok": False, "error": f"GNOME Shell screenshot output missing: {shot_path}"}
    if shot_path != out_png:
        try:
            shutil.move(shot_path, out_png)
            shot_path = out_png
        except OSError as err:
            return {"ok": False, "error": f"failed to move {shot_path} -> {out_png}: {err}"}
    return _result_for_existing_png(shot_path)


def capture(out_png: str) -> dict:
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    proxy = bus.get_object(BUS, PATH)
    iface = dbus.Interface(proxy, SCREENSHOT_IFACE)

    handle_token = _random_token()
    request_path = f"/org/freedesktop/portal/desktop/request/{_sender_name(bus)}/{handle_token}"

    loop = GLib.MainLoop()
    result: dict = {}

    def on_response(code, results):
        result["code"] = int(code)
        result["results"] = dict(results) if results else {}
        loop.quit()

    request_proxy = bus.get_object(BUS, request_path)
    match = request_proxy.connect_to_signal(
        "Response", on_response, dbus_interface=REQUEST_IFACE
    )

    timed_out = {"fired": False}

    def on_timeout():
        timed_out["fired"] = True
        loop.quit()
        return False

    timeout_id = GLib.timeout_add_seconds(CAPTURE_TIMEOUT_S, on_timeout)

    try:
        iface.Screenshot(
            "",
            {
                "handle_token": handle_token,
                "modal": False,
                "interactive": True,
            },
        )
    except dbus.DBusException as err:
        match.remove()
        GLib.source_remove(timeout_id)
        return {"ok": False, "error": f"Screenshot call failed: {err}"}

    loop.run()
    match.remove()
    if not timed_out["fired"]:
        GLib.source_remove(timeout_id)
    else:
        return {"ok": False, "error": "screenshot portal request timed out"}

    code = result.get("code", -1)
    if code != 0:
        if code == 2:
            fallback = capture_via_gnome_shell(out_png)
            if fallback.get("ok"):
                return fallback
            return {
                "ok": False,
                "error": f"Screenshot failed (code=2); {fallback.get('error', 'GNOME Shell fallback failed')}",
            }
        msg = "user cancelled screenshot" if code == 1 else f"Screenshot failed (code={code})"
        return {"ok": False, "error": msg}

    uri = result.get("results", {}).get("uri")
    if not uri:
        return {"ok": False, "error": "Screenshot response missing uri"}

    src_path = _path_from_uri_or_path(str(uri))
    if not os.path.exists(src_path):
        return {"ok": False, "error": f"Screenshot uri does not exist on disk: {src_path}"}

    try:
        # Portal writes to its own temp path. Move (or copy+unlink) into ours
        # so the caller gets the file at the requested location and the portal
        # temp is cleaned up.
        shutil.move(src_path, out_png)
    except OSError as err:
        return {"ok": False, "error": f"failed to move {src_path} -> {out_png}: {err}"}

    try:
        width, height = _read_png_dims(out_png)
    except (OSError, ValueError) as err:
        return {"ok": False, "error": f"failed to read PNG dims: {err}"}

    return {"ok": True, "path": out_png, "width": width, "height": height}


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "error": "usage: screenshot-capture.py <png-out-path>"}))
        return 2
    out_png = sys.argv[1]
    try:
        result = capture(out_png)
    except Exception as err:
        result = {"ok": False, "error": f"{type(err).__name__}: {err}"}
    print(json.dumps(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
