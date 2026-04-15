"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Music2, Play, Square } from "lucide-react";
import { WidgetContainer } from "./WidgetContainer";
import { useLiveEngine } from "@/lib/hooks/useLiveEngine";

export function LiveTransportWidget() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <WidgetContainer title="Live" icon={<Music2 size={14} />} defaultExpanded={true}>
        <div className="live-widget-row"><div className="live-widget-label">loading…</div></div>
      </WidgetContainer>
    );
  }
  return <LiveTransportWidgetInner />;
}

function LiveTransportWidgetInner() {
  const { engine, state } = useLiveEngine();

  return (
    <WidgetContainer
      title="Live"
      icon={<Music2 size={14} />}
      badge={state.playing ? "playing" : undefined}
      defaultExpanded={true}
    >
      <div className="live-widget-row">
        <button
          className="live-play-btn"
          style={{ width: 28, height: 28 }}
          onClick={() => engine.toggle()}
          aria-label={state.playing ? "Stop" : "Play"}
        >
          {state.playing ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
        </button>
        <div>
          <div className="live-widget-bpm">{state.bpm}</div>
          <div className="live-widget-label">bpm</div>
        </div>
        <Link
          href="/deck/live"
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          open →
        </Link>
      </div>
    </WidgetContainer>
  );
}
