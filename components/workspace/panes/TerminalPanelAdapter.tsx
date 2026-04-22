"use client";

import { useEffect } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { CapabilityNotFoundError, registerPane } from "@/lib/workspace";

interface TerminalParams {
  instanceId?: string;
}

/**
 * Dockview adapter for TerminalPane. Shallow wrapper — TerminalPane
 * stays untouched, we mount it inside a Dockview panel and register a
 * pane handle with the workspace bus.
 *
 * Capability surface:
 *   - `send_keys(keys)` — unwired yet (TerminalPane doesn't expose a
 *     stable imperative handle). Throws CapabilityNotFoundError-style
 *     error at the bus boundary so callers know it's not ready.
 *   - `read_last_output({ chars })` — same caveat.
 *
 * These are declared as stubs with honest "not wired yet" throws
 * rather than faked, so contract tests + agent-driven flows surface
 * the missing wiring loudly instead of silently no-op'ing.
 *
 * Phase 4 will thread a ref through TerminalPane to expose output
 * buffering + send-keys imperatively; until then, this adapter is
 * presence-only (shows the terminal UI, registers handle) and
 * callers of these capabilities get a clear "not implemented" error.
 */
export function TerminalPanelAdapter(props: IDockviewPanelProps<TerminalParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `terminal:${instanceId}`;

  useEffect(() => {
    const notImplemented = (cap: string) => () => {
      throw new CapabilityNotFoundError(paneId, `${cap} (not wired — Phase 4)`);
    };

    const off = registerPane({
      handle: { id: paneId, type: "terminal", label: props.api.title ?? "Terminal" },
      capabilities: {
        send_keys: {
          description: "Send keystrokes to the terminal. (Phase 4 — not wired.)",
          handler: notImplemented("send_keys"),
        },
        read_last_output: {
          description: "Read the last N chars of stdout. (Phase 4 — not wired.)",
          handler: notImplemented("read_last_output"),
        },
      },
      topics: {
        output: {
          expectedRatePerSec: 30,
          priority: "low",
          description: "Fires on stdout/stderr bytes. (Phase 4 — not wired.)",
        },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TerminalPane />
    </div>
  );
}
