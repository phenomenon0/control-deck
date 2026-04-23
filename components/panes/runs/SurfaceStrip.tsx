"use client";

/**
 * SurfaceStrip — the "blended" row that makes Runs feel like the hub of
 * the Control plane. Jumps the user into sibling Control tabs; shows a
 * live-running indicator when any run is in-flight.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Wrench, Layers, Bot, Cpu } from "lucide-react";

export function SurfaceStrip({ runningCount }: { runningCount: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const go = (tab: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", tab);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const surfaces: Array<{
    id: string;
    label: string;
    blurb: string;
    icon: React.ReactNode;
    live?: boolean;
  }> = [
    { id: "tools", label: "Tools", blurb: "Registered capabilities", icon: <Wrench size={14} /> },
    { id: "studio", label: "UI Studio", blurb: "Generative UI playground", icon: <Layers size={14} /> },
    { id: "agentgo", label: "Agent-GO", blurb: "Go-powered agent loop", icon: <Bot size={14} />, live: runningCount > 0 },
    { id: "models", label: "Models", blurb: "Provider + model config", icon: <Cpu size={14} /> },
  ];

  return (
    <div className="surface-strip">
      {surfaces.map((s) => (
        <button key={s.id} type="button" onClick={() => go(s.id)} className="surface-strip-tile">
          <div className="surface-strip-tile-head">
            <span className="surface-strip-tile-icon">{s.icon}</span>
            <span className="surface-strip-tile-label">{s.label}</span>
            {s.live && <span className="surface-strip-tile-live" title="Active" />}
          </div>
          <div className="surface-strip-tile-blurb">{s.blurb}</div>
        </button>
      ))}
    </div>
  );
}
