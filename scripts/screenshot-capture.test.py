#!/usr/bin/env python3
"""Unit tests for the Linux screenshot helper fallback paths.

The production helper talks to xdg-desktop-portal over DBus. These tests stub
DBus/GLib in-process so they run without opening a real portal dialog or taking
a real screenshot.
"""
from __future__ import annotations

import base64
import importlib.util
import pathlib
import sys
import tempfile
import types
import unittest

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def load_helper_module():
    """Import screenshot-capture.py with fake import-time DBus/GI modules."""
    fake_glib = types.SimpleNamespace(
        DBusGMainLoop=lambda set_as_default=False: None,
    )
    fake_dbus = types.ModuleType("dbus")
    fake_dbus.DBusException = Exception
    fake_dbus.SessionBus = lambda: None
    fake_dbus.Interface = lambda proxy, iface: None
    fake_dbus.mainloop = types.SimpleNamespace(glib=fake_glib)

    fake_gi = types.ModuleType("gi")
    fake_repository = types.ModuleType("gi.repository")
    fake_repository.GLib = types.SimpleNamespace(
        MainLoop=lambda: None,
        timeout_add_seconds=lambda _seconds, _cb: 1,
        source_remove=lambda _source_id: None,
    )

    previous = {name: sys.modules.get(name) for name in (
        "dbus",
        "dbus.mainloop",
        "dbus.mainloop.glib",
        "gi",
        "gi.repository",
    )}
    sys.modules["dbus"] = fake_dbus
    sys.modules["dbus.mainloop"] = fake_dbus.mainloop
    sys.modules["dbus.mainloop.glib"] = fake_glib
    sys.modules["gi"] = fake_gi
    sys.modules["gi.repository"] = fake_repository
    try:
        path = pathlib.Path(__file__).with_name("screenshot-capture.py")
        spec = importlib.util.spec_from_file_location("screenshot_capture", path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, value in previous.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


class ScreenshotCaptureFallbackTest(unittest.TestCase):
    def test_portal_code_2_falls_back_to_gnome_shell_screenshot(self):
        mod = load_helper_module()

        class State:
            response_cb = None
            portal_called = False
            gnome_calls = []

        state = State()

        class FakeMatch:
            def remove(self):
                pass

        class FakeRequestProxy:
            def connect_to_signal(self, _name, callback, dbus_interface=None):
                state.response_cb = callback
                return FakeMatch()

        class FakePortalIface:
            def Screenshot(self, _parent_window, _options):
                state.portal_called = True

        class FakeGnomeShellScreenshotIface:
            def Screenshot(self, include_cursor, flash, filename):
                state.gnome_calls.append((include_cursor, flash, filename))
                pathlib.Path(filename).write_bytes(PNG_1X1)
                return True, filename

        class FakeBus:
            def get_unique_name(self):
                return ":1.234"

            def get_object(self, bus_name, object_path):
                if bus_name == mod.BUS and object_path == mod.PATH:
                    return "portal-root"
                if bus_name == mod.BUS and object_path.startswith("/org/freedesktop/portal/desktop/request/"):
                    return FakeRequestProxy()
                if bus_name == "org.gnome.Shell.Screenshot" and object_path == "/org/gnome/Shell/Screenshot":
                    return "gnome-shell-screenshot"
                raise AssertionError(f"unexpected object lookup: {bus_name} {object_path}")

        class FakeLoop:
            def run(self):
                assert state.response_cb is not None
                state.response_cb(2, {})

            def quit(self):
                pass

        mod.dbus = types.SimpleNamespace(
            DBusException=Exception,
            SessionBus=lambda: FakeBus(),
            Interface=lambda proxy, iface: (
                FakePortalIface()
                if iface == mod.SCREENSHOT_IFACE
                else FakeGnomeShellScreenshotIface()
                if iface == "org.gnome.Shell.Screenshot"
                else (_ for _ in ()).throw(AssertionError(f"unexpected iface: {iface}"))
            ),
            mainloop=types.SimpleNamespace(
                glib=types.SimpleNamespace(DBusGMainLoop=lambda set_as_default=False: None),
            ),
        )
        mod.GLib = types.SimpleNamespace(
            MainLoop=lambda: FakeLoop(),
            timeout_add_seconds=lambda _seconds, _cb: 1,
            source_remove=lambda _source_id: None,
        )

        with tempfile.TemporaryDirectory() as tmp:
            out_png = str(pathlib.Path(tmp) / "shot.png")
            result = mod.capture(out_png)

        self.assertTrue(result["ok"], result)
        self.assertTrue(state.portal_called)
        self.assertEqual(state.gnome_calls, [(True, False, out_png)])
        self.assertEqual(result["path"], out_png)
        self.assertEqual(result["width"], 1)
        self.assertEqual(result["height"], 1)


if __name__ == "__main__":
    unittest.main()
