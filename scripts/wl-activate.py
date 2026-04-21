#!/usr/bin/env python3
"""
Wayland activation helper — mints a valid xdg_activation_v1 token and
hands it to a target D-Bus application so the compositor honours the
raise-and-focus request.

A bare D-Bus `Application.Activate` from a terminal fails on GNOME
Wayland: Mutter's `token_can_activate` requires the caller to be a
Wayland client with a focused surface at the activation serial. This
helper satisfies that check by presenting a tiny window, waiting
until the compositor actually marks it active, dispatching the
Activate, then holding the focused state until the target window has
picked up focus (we exit on our own focus-out).

Usage:
    wl-activate.py <app-id>                # e.g. org.telegram.desktop
    wl-activate.py <app-id> <desktop-file> # explicit .desktop path
"""

import sys
import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gtk, Gdk, Gio, GLib


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: wl-activate.py <app-id> [desktop-file]", file=sys.stderr)
        return 2

    app_id = sys.argv[1]
    desktop_path = sys.argv[2] if len(sys.argv) > 2 else None

    activator = Gtk.Application(
        application_id="com.control_deck.WlActivate",
        flags=Gio.ApplicationFlags.NON_UNIQUE,
    )
    state = {"activated": False, "exit_code": 1}

    def dispatch(window: Gtk.Window) -> None:
        if state["activated"]:
            return
        state["activated"] = True
        launch_ctx = Gdk.Display.get_default().get_app_launch_context()
        if desktop_path:
            info = Gio.DesktopAppInfo.new_from_filename(desktop_path)
        else:
            info = Gio.DesktopAppInfo.new(f"{app_id}.desktop")
        if info is None:
            print(f"[wl-activate] no AppInfo for {app_id}", file=sys.stderr)
            activator.quit()
            return
        try:
            info.launch([], launch_ctx)
            state["exit_code"] = 0
            print(f"[wl-activate] activation dispatched to {app_id}")
        except GLib.Error as e:
            print(f"[wl-activate] launch failed: {e.message}", file=sys.stderr)
            activator.quit()
            return
        # Hard backstop: if the target never pulls focus from us within
        # 2 seconds, give up and let the caller try again.
        GLib.timeout_add(2000, lambda: (activator.quit(), False)[1])

    def on_is_active(window: Gtk.Window, _pspec) -> None:
        if window.is_active():
            # We are the focused surface now — mint + dispatch.
            dispatch(window)
        elif state["activated"]:
            # Target grabbed focus away from us. Our job is done.
            GLib.timeout_add(80, lambda: (activator.quit(), False)[1])

    def on_activate(app: Gtk.Application) -> None:
        win = Gtk.ApplicationWindow(application=app)
        win.set_default_size(1, 1)
        win.set_decorated(False)
        win.set_title("control-deck-activator")
        win.set_opacity(0.0)
        win.connect("notify::is-active", on_is_active)
        win.present()
        # Dispatch regardless of whether we ever went active — the
        # compositor may still accept the token based on the recency
        # heuristic (last-input timestamp).
        GLib.timeout_add(300, lambda: (dispatch(win), False)[1])
        # Hard ceiling: the whole helper dies after 2.5s even if nobody
        # ever takes focus from us.
        GLib.timeout_add(2500, lambda: (activator.quit(), False)[1])

    activator.connect("activate", on_activate)
    activator.run([])
    return state["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
