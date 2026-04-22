"use client";

import { useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { call, publish, registerPane, subscribe } from "@/lib/workspace";

interface PlaceholderParams {
  paneType?: string;
  instanceId?: string;
}

/**
 * Temporary placeholder panel — Phase 2 scaffolding.
 *
 * Registers a stub PaneHandle with the bus, exposes 2 toy
 * capabilities (`echo`, `read_tick`), and publishes a `tick` topic
 * every 2s so you can see the subscription plumbing work in the
 * inspector. Gets replaced by the real chat/terminal adapters in
 * Phase 3.
 */
export function PlaceholderPane(props: IDockviewPanelProps<PlaceholderParams>) {
  const params = props.params ?? {};
  const paneType = params.paneType ?? "placeholder";
  const instanceId = params.instanceId ?? props.api.id;
  const paneId = `${paneType}:${instanceId}`;

  const tickRef = useRef(0);
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) =>
    setLog((l) => [...l.slice(-9), `[${new Date().toISOString().slice(11, 19)}] ${line}`]);

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: paneType, label: props.api.title ?? paneId },
      capabilities: {
        echo: {
          description: "Echo a string back, prefixed with paneId",
          handler: (args: unknown) => `${paneId} echoed: ${(args as { text: string }).text}`,
        },
        read_tick: {
          description: "Read the current tick counter",
          handler: () => tickRef.current,
        },
      },
      topics: {
        tick: { expectedRatePerSec: 0.5, priority: "low", description: "Heartbeat every ~2s" },
      },
      onUnmount: () => { /* placeholder — nothing to tear down */ },
    });

    const interval = setInterval(() => {
      tickRef.current += 1;
      publish(paneId, "tick", tickRef.current);
    }, 2000);

    return () => {
      clearInterval(interval);
      off();
    };
  }, [paneId, paneType, props.api.title]);

  const tryCall = async () => {
    try {
      const targetId = paneType === "chat" ? "terminal:terminal-default" : "chat:chat-default";
      const result = await call(targetId, "echo", { text: `ping from ${paneId}` });
      append(`call(${targetId}.echo) → ${String(result)}`);
    } catch (err) {
      append(`call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const trySubscribe = () => {
    const targetId = paneType === "chat" ? "terminal:terminal-default" : "chat:chat-default";
    const unsub = subscribe(targetId, "tick", (n) => append(`${targetId}.tick → ${n}`), {
      mode: "latest-only",
      ms: 1000,
    });
    setTimeout(unsub, 5000);
    append(`subscribed to ${targetId}.tick for 5s`);
  };

  return (
    <div style={{
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      height: "100%",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: 12,
      color: "var(--fg, #ddd)",
      background: "var(--bg, #121212)",
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          {props.api.title}
        </div>
        <div style={{ opacity: 0.6 }}>paneId: {paneId}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={tryCall} style={btnStyle}>call peer.echo</button>
        <button onClick={trySubscribe} style={btnStyle}>subscribe peer.tick (5s)</button>
      </div>
      <pre style={{
        margin: 0,
        padding: 8,
        flex: 1,
        overflow: "auto",
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        whiteSpace: "pre-wrap",
      }}>
        {log.join("\n") || "(no activity yet)"}
      </pre>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontFamily: "inherit",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  color: "inherit",
  cursor: "pointer",
};
