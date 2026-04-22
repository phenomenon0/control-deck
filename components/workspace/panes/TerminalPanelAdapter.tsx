"use client";

import { useCallback, useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { TerminalPane, type TerminalPaneHandle } from "@/components/panes/TerminalPane";
import { call, publish, registerPane } from "@/lib/workspace";

interface TerminalParams {
  instanceId?: string;
}

/**
 * Dockview adapter for TerminalPane. The underlying TerminalPane
 * exposes a forwardRef handle (sendKeys + readLastOutput) + an
 * onOutput callback, which the adapter forwards to the workspace bus.
 *
 * Wired capabilities (no longer stubbed):
 *   send_keys({keys})           — push keystrokes into the active session
 *   read_last_output({chars?})  — return the last N bytes of stdout/stderr
 *                                 (default 4000, capped at 64000)
 *   send_to_canvas({chars?})    — convenience that reads the last output
 *                                 and pushes it into the workspace's
 *                                 canvas pane as a code/text block.
 *
 * Published topic:
 *   output — fires per stdout/stderr chunk. Rate ceiling is 30/s;
 *            exceeded by chatty commands (ls on large dir, streams),
 *            so the bus watchdog may auto-coalesce it. That's fine —
 *            consumers declare their own rate modes.
 */
export function TerminalPanelAdapter(props: IDockviewPanelProps<TerminalParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `terminal:${instanceId}`;
  const handleRef = useRef<TerminalPaneHandle>(null);

  const onOutput = useCallback(
    (data: string) => {
      publish(paneId, "output", { data });
    },
    [paneId],
  );

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: "terminal", label: props.api.title ?? "Terminal" },
      capabilities: {
        send_keys: {
          description: "Push keystrokes into the active terminal session's stdin",
          handler: (args: unknown) => {
            const { keys } = args as { keys: string };
            return handleRef.current?.sendKeys(keys) ?? { delivered: false, reason: "no handle" };
          },
        },
        read_last_output: {
          description: "Return the last N bytes of stdout/stderr (default 4000, max 64000)",
          handler: (args: unknown) => {
            const chars = (args as { chars?: number })?.chars ?? 4000;
            return handleRef.current?.readLastOutput(chars) ?? "";
          },
        },
        send_to_canvas: {
          description: "Push the last terminal output into the workspace's default canvas pane",
          handler: async (args: unknown) => {
            const a = (args as { chars?: number; canvasId?: string; language?: string }) ?? {};
            const text = handleRef.current?.readLastOutput(a.chars ?? 8000) ?? "";
            if (!text) return { sent: false, reason: "no output available" };
            await call(a.canvasId ?? "canvas:canvas-default", "load_code", {
              code: text,
              language: a.language ?? "text",
              title: `Terminal output · ${new Date().toISOString().slice(11, 19)}`,
            });
            return { sent: true, chars: text.length };
          },
        },
      },
      topics: {
        output: {
          expectedRatePerSec: 30,
          priority: "low",
          description: "stdout/stderr bytes from the active session",
        },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TerminalPane ref={handleRef} onOutput={onOutput} />
    </div>
  );
}
