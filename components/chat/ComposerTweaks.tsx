"use client";

import React, { useEffect, useRef, useState } from "react";
import { Sliders } from "lucide-react";
import {
  useWarp,
  type Accent,
  type TypeSet,
  type Warmth,
} from "@/components/warp/WarpProvider";

const WARMTH: { value: Warmth; label: string }[] = [
  { value: "cool", label: "Cool" },
  { value: "neutral", label: "Neutral" },
  { value: "warm", label: "Warm" },
  { value: "ember", label: "Ember" },
];

const TYPE_SET: { value: TypeSet; label: string }[] = [
  { value: "matter", label: "Matter" },
  { value: "inter", label: "Inter" },
  { value: "editorial", label: "Editorial" },
];

const ACCENT: { value: Accent; label: string }[] = [
  { value: "mono", label: "Mono" },
  { value: "amber", label: "Amber" },
  { value: "ember", label: "Ember" },
  { value: "sage", label: "Sage" },
];

export function ComposerTweaks() {
  const { tweaks, setTweak } = useWarp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="composer-tweaks" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Tweaks"
        aria-expanded={open}
      >
        <Sliders size={16} />
        <span>Tweaks</span>
      </button>

      {open && (
        <div className="composer-tweaks-panel" role="dialog" aria-label="Tweaks">
          <Axis label="Warmth" options={WARMTH} value={tweaks.warmth} onChange={(v) => setTweak("warmth", v)} />
          <Axis label="Type" options={TYPE_SET} value={tweaks.type} onChange={(v) => setTweak("type", v)} />
          <Axis label="Accent" options={ACCENT} value={tweaks.accent} onChange={(v) => setTweak("accent", v)} />
        </div>
      )}
    </div>
  );
}

function Axis<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="composer-tweaks-axis">
      <span className="composer-tweaks-axis-label">{label}</span>
      <div className="composer-tweaks-axis-segs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`composer-tweaks-seg${value === o.value ? " is-active" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
