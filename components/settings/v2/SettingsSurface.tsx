"use client";

/**
 * Editorial (tabbed) Settings — the live deck settings surface.
 *
 * Calm editorial language + a real accessible left TAB RAIL (one section mounted
 * at a time, macOS System-Settings model). Left-rail tablist: role="tablist"
 * (vertical) + roving tabindex + Arrow/Home/End keys; each tab role="tab" w/
 * aria-selected + aria-controls; content is a role="tabpanel". Token-only +
 * cd-settings-* hooks → re-skins across all themes.
 *
 * WIRED LIVE: theme/warmth/accent → useWarp + useDeckSettings (DeckSettings owns
 * data-theme incl. "hacker"; Warp owns warmth/accent); model/route/voice/system
 * prompt → useDeckSettings; installed models + provider health + load/unload →
 * useHardwareProviders + /api/hardware/providers/action; GPU/VRAM → live
 * /api/resource/ledger; audio devices → enumerateDevices. Controls with no
 * enforcing backend yet persist to DeckPrefs and are flagged PERSIST-ONLY in
 * DeckSettingsProvider.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudioLines, ChevronRight, Eye, Image as ImageIcon, Type, X } from "lucide-react";

import { Badge, Button } from "@/components/chat/v2/ui";
import { ModelCard, type ModelEntry } from "@/components/models/v2/ModelCard";
import { useWarp } from "@/components/warp/WarpProvider";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useHardwareProviders } from "@/lib/hooks/useHardwareProviders";
import type { VoiceMode } from "@/components/settings/DeckSettingsProvider";
import type { ProviderId } from "@/lib/hardware/providers/types";
import {
  NumberField,
  SegmentedControl,
  Select,
  SettingGroup,
  SettingRow,
  SettingSection,
  SettingsSearch,
  Slider,
  TextField,
  ThemePicker,
  Toggle,
  useSettingsFilter,
  SETTING_DEFS,
  type Option,
  type ThemeState,
} from "@/components/settings/v2/controls";

// ── Tab map (curated: 8 sections; Data merged into Privacy) ───────────────────
type NavItem = { id: string; label: string };
export const NAV: NavItem[] = [
  { id: "appearance", label: "Appearance" },
  { id: "model", label: "Model" },
  { id: "voice", label: "Voice" },
  { id: "agent", label: "Agent" },
  { id: "safety", label: "Safety" },
  { id: "hardware", label: "Hardware" },
  { id: "privacy", label: "Privacy & Data" },
  { id: "experiments", label: "Experiments" },
];

// ── Option catalogs (static reference lists, not state) ───────────────────────
// These are persist-only model picks (no server consumer reads them yet) — see
// the PERSIST-ONLY flags in DeckSettingsProvider.
const TEXT_FAST_OPTS: Option<string>[] = [
  { value: "llama3.2:3b", label: "llama3.2:3b" },
  { value: "qwen3:1.7b", label: "qwen3:1.7b" },
  { value: "phi-3.5-mini", label: "phi-3.5-mini" },
];
const VISION_OPTS: Option<string>[] = [
  { value: "llava:7b", label: "llava:7b" },
  { value: "qwen2-vl:7b", label: "qwen2-vl:7b" },
  { value: "gpt-4o", label: "GPT-4o (cloud)" },
];
const STT_OPTS: Option<string>[] = [
  { value: "whisper-large-v3", label: "Whisper large-v3" },
  { value: "whisper-base", label: "Whisper base" },
  { value: "parakeet", label: "Parakeet" },
];
// Real TTS engine ids (must match DeckPrefs VoicePrefs.ttsEngine / TTSEngine).
const TTS_ENGINE_OPTS: Option<string>[] = [
  { value: "kokoro-82m", label: "Kokoro 82M" },
  { value: "chatterbox", label: "Chatterbox" },
  { value: "sherpa-onnx-tts", label: "Sherpa ONNX" },
];
const IMAGE_OPTS: Option<string>[] = [
  { value: "flux-schnell", label: "FLUX.1 schnell" },
  { value: "sdxl-turbo", label: "SDXL Turbo" },
  { value: "sd3.5-large", label: "SD 3.5 Large" },
];
const FONT_OPTS = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
] as const;
const ROUTE_OPTS = [
  { value: "local", label: "Local" },
  { value: "free", label: "Free" },
  { value: "cloud", label: "Cloud" },
] as const;
const PRESET_OPTS = [
  { value: "quick", label: "Quick" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Quality" },
] as const;
const CAPTURE_OPTS = [
  { value: "ptt", label: "Push to talk" },
  { value: "vad", label: "Voice activity" },
  { value: "toggle", label: "Toggle" },
] as const;
const APPROVAL_OPTS = [
  { value: "never", label: "Never" },
  { value: "ask", label: "Ask" },
  { value: "cost", label: "On cost" },
  { value: "side-effect", label: "Side effects" },
] as const;

// Cloud/free catalog — shown only when online models are enabled. Static legend
// until a live free/cloud catalog feed exists.
const CATALOG: ModelEntry[] = [
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", origin: "free", modality: "text", provider: "openrouter", contextLabel: "128K", rateLabel: "12/20 rpm · 180/200 rpd", priceLabel: "free", status: "available" },
  { id: "gpt-4o", name: "GPT-4o", origin: "cloud", modality: "vision", provider: "openai", contextLabel: "128K", priceLabel: "$2.50/M in · $10/M out", status: "available" },
];

// "How to start it" hints per provider — reference doc, keyed by ProviderId.
const PROVIDER_HOWTO: Record<string, string> = {
  ollama: "ollama serve",
  vllm: "python -m vllm.entrypoints.openai_api_server --model <model>",
  llamacpp: "./llama-server -m model.gguf -ngl 33",
  "lm-studio": "Launch the LM Studio app",
  comfyui: "python main.py",
};

// Font-size scale — overrides the size tokens for the whole surface so the
// control actually resizes the type.
const FONT_PX: Record<string, { base: string; sm: string; xs: string }> = {
  small: { base: "12px", sm: "11px", xs: "10px" },
  default: { base: "13px", sm: "12px", xs: "11px" },
  large: { base: "15px", sm: "14px", xs: "13px" },
};

const fmtGb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

// Live provider row + GPU ledger shapes.
interface ProviderRowInfo {
  id: ProviderId;
  name: string;
  endpoint: string;
  online: boolean;
  installed: number;
  loaded: number;
  canManage: boolean;
  capLoad: boolean;
  capUnload: boolean;
  howTo: string;
  models: { name: string; size?: string; loaded?: boolean }[];
}
interface LedgerSnapshot {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  reserveMb: number;
  processes: { pid: number; processName: string; usedMemoryMb: number }[];
}

/** Small labelled stat for detail panels. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>{label}</span>
      <span className="text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{value}</span>
    </div>
  );
}

/** Right-hand detail/context panel — opens only for settings that escalate value. */
function DetailPanel({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="cd-settings-detail flex w-[380px] shrink-0 flex-col overflow-y-auto border-l" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }} role="complementary" aria-label={title}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
        <div className="flex min-w-0 flex-col">
          {eyebrow && <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)", letterSpacing: "var(--tracking-label, 0.06em)" }}>{eyebrow}</span>}
          <strong className="text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--fw-strong, 600)" }}>{title}</strong>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close detail" className="shrink-0">
          <X size={15} />
        </Button>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
    </aside>
  );
}

/** A drill-in row — opens a detail panel. Used only where a second context adds value. */
function DrillRow({ label, description, summary, selected, onOpen }: { label: string; description?: string; summary?: ReactNode; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={selected}
      className="cd-settings-drill flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ background: selected ? "var(--bg-tertiary)" : "transparent" }}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}>{label}</span>
        {description && <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>{description}</span>}
      </span>
      {summary && <span className="ml-auto text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{summary}</span>}
      <ChevronRight size={15} className={summary ? "" : "ml-auto"} style={{ color: selected ? "rgb(var(--accent-rgb))" : "var(--text-muted)" }} aria-hidden="true" />
    </button>
  );
}

/** A provider list row (drill-in) — health dot + endpoint + model count. */
function ProviderRow({ p, selected, onOpen }: { p: ProviderRowInfo; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={selected}
      className="cd-settings-drill flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ background: selected ? "var(--bg-tertiary)" : "transparent" }}
    >
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: p.online ? "#3fb950" : "var(--text-muted)" }} aria-hidden="true" />
      <span className="text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}>{p.name}</span>
      <span className="truncate text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{p.endpoint.replace("http://", "")}</span>
      <span className="ml-auto shrink-0 text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{p.online ? `${p.installed} models` : "offline"}</span>
      <ChevronRight size={15} className="shrink-0" style={{ color: selected ? "rgb(var(--accent-rgb))" : "var(--text-muted)" }} aria-hidden="true" />
    </button>
  );
}

// ── Tab rail ──────────────────────────────────────────────────────────────────
function TabRail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (id: string) => {
      onSelect(id);
      listRef.current?.querySelector<HTMLElement>(`#tab-${id}`)?.focus();
    },
    [onSelect],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = NAV.findIndex((n) => n.id === active);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(NAV[(i + 1) % NAV.length].id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(NAV[(i - 1 + NAV.length) % NAV.length].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(NAV[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      move(NAV[NAV.length - 1].id);
    }
  };

  return (
    <nav className="cd-settings-tabrail sticky top-8 flex w-44 shrink-0 flex-col gap-2" aria-label="Settings sections">
      <span
        className="px-2 uppercase text-[var(--text-muted)]"
        style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)", letterSpacing: "var(--tracking-label, 0.06em)" }}
      >
        Settings
      </span>
      <div ref={listRef} role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
        {NAV.map((n) => {
          const current = n.id === active;
          return (
            <button
              key={n.id}
              id={`tab-${n.id}`}
              type="button"
              role="tab"
              aria-selected={current}
              aria-controls={`panel-${n.id}`}
              tabIndex={current ? 0 : -1}
              onClick={() => onSelect(n.id)}
              className="cd-settings-tab rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors"
              style={{
                background: current ? "rgb(var(--accent-rgb))" : "transparent",
                color: current ? "var(--text-on-accent)" : "var(--text-secondary)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--font-size-sm)",
                fontWeight: current ? "var(--fw-strong, 600)" : 400,
              }}
            >
              {n.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// Minimal modality set for the Model tab.
const MODALITY_TABS = [
  { id: "text", label: "Text", Icon: Type },
  { id: "speech", label: "Speech", Icon: AudioLines },
  { id: "vision", label: "Vision", Icon: Eye },
  { id: "image", label: "Image", Icon: ImageIcon },
] as const;

/** Horizontal modality sub-tabs nested inside the Model section. */
function ModalityTabs({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Modality" className="cd-settings-subtabs flex gap-1 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      {MODALITY_TABS.map(({ id, label, Icon }) => {
        const cur = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`mtab-${id}`}
            aria-selected={cur}
            aria-controls={`mpanel-${id}`}
            tabIndex={cur ? 0 : -1}
            onClick={() => onSelect(id)}
            className="cd-settings-subtab -mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 transition-colors"
            style={{
              borderColor: cur ? "rgb(var(--accent-rgb))" : "transparent",
              color: cur ? "var(--text-primary)" : "var(--text-secondary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-sm)",
              fontWeight: cur ? "var(--fw-strong, 600)" : 400,
            }}
          >
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        );
      })}
    </div>
  );
}

// ── The composed surface ──────────────────────────────────────────────────────
export function SettingsSurface() {
  const { tweaks, setTweak } = useWarp();
  const { prefs, updatePrefs, updateVoicePrefs, switchRouteMode } = useDeckSettings();
  const { providers, refetch } = useHardwareProviders();

  // Ephemeral UI state only.
  const [modality, setModality] = useState<string>("text");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(NAV[0].id);
  // detail = "provider:<id>" | "hardware" | "glyph" | null.
  const [detail, setDetail] = useState<string | null>(null);

  const filtered = useSettingsFilter(SETTING_DEFS, query);
  const matchCount = filtered.length;

  // ── live model data ──
  const enabledProviders = providers.filter((p) => !prefs.disabledProviders.includes(p.id));
  const installedEntries: ModelEntry[] = enabledProviders.flatMap((p) =>
    p.installed.map((m) => ({
      id: m.name,
      name: m.displayName || m.name,
      origin: "local",
      modality: "text",
      provider: p.id,
      paramSize: m.params,
      quant: m.quant,
      sizeLabel: m.sizeBytes ? fmtBytes(m.sizeBytes) : undefined,
      status: p.loaded.some((l) => l.name === m.name) ? "ready" : "available",
      isDefault: m.name === prefs.model,
    })),
  );
  const modelOpts: Option<string>[] = installedEntries.length
    ? installedEntries.map((m) => ({ value: m.id, label: m.name }))
    : [{ value: prefs.model || "", label: prefs.model || "no models installed" }];
  const activeModelEntry: ModelEntry =
    installedEntries.find((m) => m.isDefault) ??
    installedEntries[0] ?? {
      id: prefs.model || "—",
      name: prefs.model || "No model selected",
      origin: "local",
      modality: "text",
      status: "not-wired",
      isDefault: true,
    };

  const providerRows: ProviderRowInfo[] = providers.map((p) => ({
    id: p.id,
    name: p.label,
    endpoint: p.url || p.health.url,
    online: p.health.online && !prefs.disabledProviders.includes(p.id),
    installed: p.installed.length,
    loaded: p.loaded.length,
    canManage: p.capabilities.load || p.capabilities.unload,
    capLoad: p.capabilities.load,
    capUnload: p.capabilities.unload,
    howTo: PROVIDER_HOWTO[p.id] ?? "",
    models: p.installed.map((m) => ({
      name: m.name,
      size: m.sizeBytes ? fmtBytes(m.sizeBytes) : undefined,
      loaded: p.loaded.some((l) => l.name === m.name),
    })),
  }));
  const detailProvider = detail?.startsWith("provider:")
    ? providerRows.find((p) => p.id === detail.slice("provider:".length)) ?? null
    : null;

  // ── live GPU ledger (fetched when the hardware detail opens) ──
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const refreshLedger = useCallback(async () => {
    try {
      const r = await fetch("/api/resource/ledger", { cache: "no-store" });
      if (r.ok) setLedger((await r.json()) as LedgerSnapshot);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (detail === "hardware") void refreshLedger();
  }, [detail, refreshLedger]);
  const freeGpu = useCallback(async () => {
    try {
      await fetch("/api/comfy/free", { method: "POST" });
    } catch {
      /* ignore */
    }
    await refreshLedger();
  }, [refreshLedger]);

  // ── live audio devices ──
  const [audioInOpts, setAudioInOpts] = useState<Option<string>[]>([{ value: "default", label: "System default" }]);
  const [audioOutOpts, setAudioOutOpts] = useState<Option<string>[]>([{ value: "default", label: "System default" }]);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devs) => {
        if (cancelled) return;
        const ins: Option<string>[] = [{ value: "default", label: "System default" }];
        const outs: Option<string>[] = [{ value: "default", label: "System default" }];
        devs.forEach((d, i) => {
          if (d.kind === "audioinput") ins.push({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` });
          if (d.kind === "audiooutput") outs.push({ value: d.deviceId, label: d.label || `Speaker ${i + 1}` });
        });
        setAudioInOpts(ins);
        setAudioOutOpts(outs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── actions ──
  const onThemePatch = useCallback(
    (patch: Partial<ThemeState>) => {
      if (patch.theme) updatePrefs({ theme: patch.theme }); // dark|light|hacker (canonical)
      if (patch.warmth) setTweak("warmth", patch.warmth);
      if (patch.accent) setTweak("accent", patch.accent);
    },
    [updatePrefs, setTweak],
  );

  const setActiveModel = useCallback(
    (id: string) => updatePrefs(prefs.routeMode === "local" ? { model: id, localModel: id } : { model: id, remoteModel: id }),
    [updatePrefs, prefs.routeMode],
  );
  const onCopyId = useCallback((id: string) => {
    void navigator.clipboard?.writeText(id);
  }, []);
  const providerAction = useCallback(
    async (providerId: string, action: "load" | "unload", model: string) => {
      try {
        await fetch("/api/hardware/providers/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, action, model }),
        });
      } catch {
        /* ignore */
      }
      await refetch();
    },
    [refetch],
  );
  // "Delete" maps to unload (no on-disk delete endpoint); only on providers that support it.
  const onDelete = useCallback(
    (id: string) => {
      const owner = providers.find((p) => p.installed.some((m) => m.name === id));
      if (owner && owner.capabilities.unload) void providerAction(owner.id, "unload", id);
    },
    [providers, providerAction],
  );

  const fontVars = FONT_PX[prefs.fontScale] ?? FONT_PX.default;
  const surfaceStyle = {
    fontFamily: "var(--font-sans)",
    "--font-size-base": fontVars.base,
    "--font-size-sm": fontVars.sm,
    "--font-size-xs": fontVars.xs,
  } as CSSProperties;

  const captureValue = prefs.voice.mode === "push-to-talk" ? "ptt" : prefs.voice.mode;
  // silenceThreshold is a 0–0.08 float; surface it as a 0–100% slider.
  const thresholdPct = Math.round((prefs.voice.silenceThreshold / 0.08) * 100);

  return (
    <div className="cd-settings-editorial flex min-h-0 flex-1 bg-[var(--bg)] text-[var(--text-primary)]" style={surfaceStyle}>
      <div className="flex h-full w-full">
        <div className="shrink-0 py-8 pl-6 pr-2">
          <TabRail active={active} onSelect={setActive} />
        </div>

        <main className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-8">
          {/* Slim masthead — just a title + search. */}
          <div className="flex flex-col gap-2">
            <h1
              className="text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "calc(var(--font-size-base) * 1.5)", fontWeight: "var(--fw-heading, 700)", letterSpacing: "var(--tracking-tight, -0.02em)" }}
            >
              Settings
            </h1>
            <div className="max-w-md">
              <SettingsSearch query={query} onQuery={setQuery} placeholder="Search every setting…" />
              {query.trim() && (
                <span className="mt-1.5 block text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }} role="status">
                  {matchCount} setting{matchCount === 1 ? "" : "s"} match “{query}”
                </span>
              )}
            </div>
          </div>

          {/* Active tab panel — one section at a time. */}
          <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} tabIndex={0} className="flex flex-col gap-8 outline-none">
            {active === "appearance" && (
              <SettingSection id="appearance" title="Appearance" description="Theme, type, and accent — set once; the whole deck follows.">
                <SettingGroup>
                  <ThemePicker theme={prefs.theme} warmth={tweaks.warmth} accent={tweaks.accent} onChange={onThemePatch} />
                </SettingGroup>
                <SettingGroup>
                  <SettingRow
                    label="Font size"
                    description="Scale the interface type up or down."
                    htmlFor="fontScale"
                    control={<SegmentedControl id="fontScale" value={prefs.fontScale} onChange={(v) => updatePrefs({ fontScale: v })} options={[...FONT_OPTS]} ariaLabel="Font size" />}
                  />
                  <SettingRow
                    label="Reduce motion"
                    description="Disable nonessential animations and transitions."
                    htmlFor="reduceMotion"
                    control={<Toggle id="reduceMotion" checked={prefs.reduceMotion} onChange={(v) => updatePrefs({ reduceMotion: v })} label="Reduce motion" />}
                  />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "model" && (
              <SettingSection id="model" title="Model" description="Pick the model that serves each modality.">
                <ModalityTabs active={modality} onSelect={setModality} />

                <div role="tabpanel" id={`mpanel-${modality}`} aria-labelledby={`mtab-${modality}`} tabIndex={0} className="flex flex-col gap-6 outline-none">
                  {modality === "text" && (
                    <>
                      <div style={{ maxWidth: 360 }}>
                        <ModelCard model={activeModelEntry} size="default" onCopyId={onCopyId} />
                      </div>
                      <SettingGroup>
                        <SettingRow label="Primary model" description="Your main chat + reasoning model." htmlFor="activeModel" control={<Select id="activeModel" value={prefs.model} onChange={setActiveModel} options={modelOpts} ariaLabel="Primary model" />} />
                        <SettingRow label="Fast model" description="Quick, cheap turns — titles, routing, summaries." htmlFor="textFast" control={<Select id="textFast" value={prefs.fastModel} onChange={(v) => updatePrefs({ fastModel: v })} options={TEXT_FAST_OPTS} ariaLabel="Fast model" />} />
                        <SettingRow label="Show online models" description="Reveal free + cloud routes and catalogs." htmlFor="showOnline" control={<Toggle id="showOnline" checked={prefs.showOnlineModels} onChange={(v) => updatePrefs({ showOnlineModels: v })} label="Show online models" />} />
                        <SettingRow label="Routing" description="Where chat requests are sent." htmlFor="routeMode" control={<SegmentedControl id="routeMode" value={prefs.routeMode} onChange={(v) => switchRouteMode(v)} options={[...ROUTE_OPTS]} ariaLabel="Routing" />} />
                        <SettingRow label="Local preset" description="Trade speed for quality on local inference." htmlFor="preset" control={<SegmentedControl id="preset" value={prefs.localModelPreset} onChange={(v) => updatePrefs({ localModelPreset: v })} options={[...PRESET_OPTS]} ariaLabel="Local preset" />} />
                      </SettingGroup>

                      <div className="flex flex-col gap-2">
                        <span className="uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>
                          Installed locally
                        </span>
                        <div className="flex flex-col gap-1">
                          {installedEntries.length === 0 && (
                            <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>No local models found — start a provider (e.g. <code style={{ fontFamily: "var(--font-mono)" }}>ollama serve</code>).</span>
                          )}
                          {installedEntries.map((m) => (
                            <ModelCard key={`${m.provider}:${m.id}`} model={m} size="collapse" onSetDefault={setActiveModel} onDelete={onDelete} onCopyId={onCopyId} />
                          ))}
                        </div>
                      </div>

                      <SettingGroup title="System prompt">
                        <SettingRow
                          label="Base instructions"
                          description="Prepended to every conversation."
                          control={
                            <textarea
                              aria-label="System prompt"
                              value={prefs.systemPrompt}
                              onChange={(e) => updatePrefs({ systemPrompt: e.target.value })}
                              rows={3}
                              className="cd-settings-field w-full min-w-[18rem] resize-y rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[var(--text-primary)]"
                              style={{ borderColor: "var(--border)", fontSize: "var(--font-size-sm)", fontFamily: "var(--font-sans)", lineHeight: "var(--lh-body, 1.5)" }}
                            />
                          }
                        />
                      </SettingGroup>

                      {prefs.showOnlineModels && (
                        <div className="flex flex-col gap-2 opacity-90">
                          <span className="uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)", letterSpacing: "var(--tracking-label, 0.04em)" }}>
                            Cloud & free catalog
                          </span>
                          <div className="flex flex-col gap-1">
                            {CATALOG.map((m) => (
                              <ModelCard key={m.id} model={m} size="collapse" onSetDefault={setActiveModel} onCopyId={onCopyId} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {modality === "speech" && (
                    <SettingGroup>
                      <SettingRow label="Speech-to-text" description="Transcribes your microphone." htmlFor="sttModel" control={<Select id="sttModel" value={prefs.sttModel} onChange={(v) => updatePrefs({ sttModel: v })} options={STT_OPTS} ariaLabel="Speech-to-text model" />} />
                      <SettingRow label="Text-to-speech" description="The voice the deck speaks with." htmlFor="ttsModel" control={<Select id="ttsModel" value={prefs.voice.ttsEngine} onChange={(v) => updateVoicePrefs({ ttsEngine: v as typeof prefs.voice.ttsEngine })} options={TTS_ENGINE_OPTS} ariaLabel="Text-to-speech engine" />} />
                    </SettingGroup>
                  )}

                  {modality === "vision" && (
                    <SettingGroup>
                      <SettingRow label="Vision model" description="Understands images you share in chat." htmlFor="visionModel" control={<Select id="visionModel" value={prefs.visionModel} onChange={(v) => updatePrefs({ visionModel: v })} options={VISION_OPTS} ariaLabel="Vision model" />} />
                    </SettingGroup>
                  )}

                  {modality === "image" && (
                    <SettingGroup>
                      <SettingRow label="Image model" description="Text-to-image — runs through the ComfyUI surface." htmlFor="imageModel" control={<Select id="imageModel" value={prefs.imageModel} onChange={(v) => updatePrefs({ imageModel: v })} options={IMAGE_OPTS} ariaLabel="Image model" />} />
                    </SettingGroup>
                  )}
                </div>
              </SettingSection>
            )}

            {active === "voice" && (
              <SettingSection id="voice" title="Voice" description="Pick your microphone and speaker, then tune how it listens.">
                <SettingGroup>
                  <SettingRow label="Voice" htmlFor="voiceEnabled" control={<Toggle id="voiceEnabled" checked={prefs.voice.enabled} onChange={(v) => updateVoicePrefs({ enabled: v })} label="Voice" />} />
                  <SettingRow label="Read replies aloud" htmlFor="readAloud" control={<Toggle id="readAloud" checked={prefs.voice.readAloud} onChange={(v) => updateVoicePrefs({ readAloud: v })} label="Read replies aloud" />} />
                  <SettingRow label="Input device" htmlFor="audioIn" control={<Select id="audioIn" value={prefs.voice.audioInputId ?? "default"} onChange={(v) => updateVoicePrefs({ audioInputId: v === "default" ? null : v })} options={audioInOpts} ariaLabel="Input device" />} />
                  <SettingRow label="Output device" htmlFor="audioOut" control={<Select id="audioOut" value={prefs.voice.audioOutputId ?? "default"} onChange={(v) => updateVoicePrefs({ audioOutputId: v === "default" ? null : v })} options={audioOutOpts} ariaLabel="Output device" />} />
                </SettingGroup>
                <SettingGroup title="Capture & synthesis">
                  <SettingRow label="Capture mode" htmlFor="capture" control={<SegmentedControl id="capture" value={captureValue} onChange={(v) => updateVoicePrefs({ mode: (v === "ptt" ? "push-to-talk" : v) as VoiceMode })} options={[...CAPTURE_OPTS]} ariaLabel="Capture mode" />} />
                  <SettingRow label="TTS engine" htmlFor="tts" control={<Select id="tts" value={prefs.voice.ttsEngine} onChange={(v) => updateVoicePrefs({ ttsEngine: v as typeof prefs.voice.ttsEngine })} options={TTS_ENGINE_OPTS} ariaLabel="TTS engine" />} />
                  <SettingRow label="Silence timeout" htmlFor="silenceMs" control={<Slider id="silenceMs" value={prefs.voice.silenceTimeoutMs} onChange={(v) => updateVoicePrefs({ silenceTimeoutMs: v })} min={200} max={2000} step={50} unit="ms" ariaLabel="Silence timeout" />} />
                  <SettingRow label="Activation threshold" htmlFor="threshold" control={<Slider id="threshold" value={thresholdPct} onChange={(v) => updateVoicePrefs({ silenceThreshold: (v / 100) * 0.08 })} min={0} max={100} unit="%" ariaLabel="Activation threshold" />} />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "agent" && (
              <SettingSection id="agent" title="Agent" description="Defaults applied to every run.">
                <SettingGroup>
                  <SettingRow label="Temperature" htmlFor="temperature" control={<Slider id="temperature" value={Math.round(prefs.temperature * 100)} onChange={(v) => updatePrefs({ temperature: v / 100 })} min={0} max={100} unit="%" ariaLabel="Temperature" />} />
                  <SettingRow label="Max tokens" htmlFor="maxTokens" control={<NumberField id="maxTokens" value={prefs.maxTokens} onChange={(v) => updatePrefs({ maxTokens: v })} min={256} max={32768} step={256} ariaLabel="Max tokens" />} />
                  <SettingRow label="Cost budget" description="Stop a run that would exceed this." htmlFor="costBudget" control={<NumberField id="costBudget" value={prefs.costBudget} onChange={(v) => updatePrefs({ costBudget: v })} min={0} max={100} step={1} ariaLabel="Cost budget" />} />
                  <SettingRow
                    label="Auto-execute tools"
                    description="Run tools without asking first."
                    htmlFor="autoTools"
                    badge={prefs.autoExecuteTools ? { text: "on", tone: "accent" } : undefined}
                    control={<Toggle id="autoTools" checked={prefs.autoExecuteTools} onChange={(v) => updatePrefs({ autoExecuteTools: v })} label="Auto-execute tools" />}
                  />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "safety" && (
              <SettingSection id="safety" title="Safety" description="When the agent must stop and ask.">
                <SettingGroup>
                  <SettingRow label="Approval mode" htmlFor="approvalMode" control={<SegmentedControl id="approvalMode" value={prefs.approvalMode} onChange={(v) => updatePrefs({ approvalMode: v })} options={[...APPROVAL_OPTS]} ariaLabel="Approval mode" />} />
                  <SettingRow label="Cost threshold" description="Ask before a tool call past this cost." htmlFor="costThreshold" control={<NumberField id="costThreshold" value={prefs.costThreshold} onChange={(v) => updatePrefs({ costThreshold: v })} min={0} max={50} step={0.5} ariaLabel="Cost threshold" />} />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "hardware" && (
              <SettingSection id="hardware" title="Hardware & Providers" description="Open a provider for its status, models, and how to start it.">
                <SettingGroup title="Inference providers">
                  {providerRows.length === 0 && (
                    <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>No providers detected.</span>
                  )}
                  {providerRows.map((p) => (
                    <ProviderRow key={p.id} p={p} selected={detail === `provider:${p.id}`} onOpen={() => setDetail(`provider:${p.id}`)} />
                  ))}
                </SettingGroup>
                <SettingGroup title="System">
                  <DrillRow label="GPU & memory" description="Live VRAM, processes, and reservations." summary={ledger ? `${fmtGb(ledger.usedMb)} / ${fmtGb(ledger.totalMb)}` : undefined} selected={detail === "hardware"} onOpen={() => setDetail("hardware")} />
                  <SettingRow label="GGUF search roots" description="Extra folders the offline scanner walks." htmlFor="ggufRoots" control={<TextField id="ggufRoots" value={prefs.ggufRoots} onChange={(v) => updatePrefs({ ggufRoots: v })} mono ariaLabel="GGUF search roots" />} />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "privacy" && (
              <SettingSection id="privacy" title="Privacy & Data" description="What leaves this machine, and how long things are kept.">
                <SettingGroup title="Privacy">
                  <SettingRow label="Analytics" htmlFor="analytics" control={<Toggle id="analytics" checked={prefs.analytics} onChange={(v) => updatePrefs({ analytics: v })} label="Analytics" />} />
                  <SettingRow label="Error reporting" htmlFor="errorReporting" control={<Toggle id="errorReporting" checked={prefs.errorReporting} onChange={(v) => updatePrefs({ errorReporting: v })} label="Error reporting" />} />
                  <SettingRow label="Telemetry retention" htmlFor="telemetryRetention" control={<NumberField id="telemetryRetention" value={prefs.telemetryRetentionDays} onChange={(v) => updatePrefs({ telemetryRetentionDays: v })} min={1} max={365} ariaLabel="Telemetry retention" />} />
                </SettingGroup>
                <SettingGroup title="Data">
                  <SettingRow label="Run retention" htmlFor="runRetention" control={<NumberField id="runRetention" value={prefs.runRetentionDays} onChange={(v) => updatePrefs({ runRetentionDays: v })} min={1} max={365} ariaLabel="Run retention" />} />
                  <SettingRow label="Upload retention" htmlFor="uploadRetention" control={<NumberField id="uploadRetention" value={prefs.uploadRetentionDays} onChange={(v) => updatePrefs({ uploadRetentionDays: v })} min={1} max={365} ariaLabel="Upload retention" />} />
                  <SettingRow label="Rules search roots" htmlFor="rulesRoots" control={<TextField id="rulesRoots" value={prefs.rulesRoots} onChange={(v) => updatePrefs({ rulesRoots: v })} mono ariaLabel="Rules search roots" />} />
                </SettingGroup>
              </SettingSection>
            )}

            {active === "experiments" && (
              <SettingSection id="experiments" title="Experiments" description="Unstable features. Here be dragons.">
                <SettingGroup>
                  <div className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 transition-colors" style={{ background: detail === "glyph" ? "var(--bg-tertiary)" : "transparent" }}>
                    <button type="button" onClick={() => setDetail("glyph")} aria-expanded={detail === "glyph"} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-1.5 text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}>
                          Glyph encoding
                          <span className="rounded-[var(--radius-sm)] border px-1 py-px uppercase" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)" }}>beta</span>
                        </span>
                        <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>Compact tool-result notation — open to see how it works.</span>
                      </span>
                      <ChevronRight size={15} className="ml-auto shrink-0" style={{ color: detail === "glyph" ? "rgb(var(--accent-rgb))" : "var(--text-muted)" }} aria-hidden="true" />
                    </button>
                    <Toggle id="glyph" checked={prefs.glyphEncoding} onChange={(v) => updatePrefs({ glyphEncoding: v })} label="Glyph encoding" />
                  </div>
                  <SettingRow label="Thread compaction" htmlFor="compaction" badge={{ text: "beta", tone: "warn" }} control={<Toggle id="compaction" checked={prefs.threadCompaction} onChange={(v) => updatePrefs({ threadCompaction: v })} label="Thread compaction" />} />
                  <SettingRow label="Skills" htmlFor="skills" control={<Toggle id="skills" checked={prefs.skillsEnabled} onChange={(v) => updatePrefs({ skillsEnabled: v })} label="Skills" />} />
                  <SettingRow label="Memory" htmlFor="memory" control={<Toggle id="memory" checked={prefs.memoryEnabled} onChange={(v) => updatePrefs({ memoryEnabled: v })} label="Memory" />} />
                </SettingGroup>
              </SettingSection>
            )}
          </div>
        </main>

        {detail && (
          <DetailPanel
            title={detailProvider ? detailProvider.name : detail === "hardware" ? "GPU & memory" : "Glyph encoding"}
            eyebrow={detailProvider ? "Provider" : detail === "hardware" ? "Hardware" : "Experiment"}
            onClose={() => setDetail(null)}
          >
            {detailProvider && (
              <>
                <div className="flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: detailProvider.online ? "#3fb950" : "var(--text-muted)" }} aria-hidden="true" />
                  <span className="text-[var(--text-secondary)]">{detailProvider.online ? "online" : "offline"}</span>
                </div>

                <Stat label="Endpoint" value={detailProvider.endpoint.replace("http://", "")} />

                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)" }}>Enabled</span>
                  <Toggle
                    checked={!prefs.disabledProviders.includes(detailProvider.id)}
                    onChange={(v) =>
                      updatePrefs({
                        disabledProviders: v
                          ? prefs.disabledProviders.filter((x) => x !== detailProvider.id)
                          : [...prefs.disabledProviders, detailProvider.id],
                      })
                    }
                    label={`Enable ${detailProvider.name}`}
                  />
                </div>

                <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <Stat label="Installed" value={String(detailProvider.installed)} />
                  <Stat label="Loaded" value={detailProvider.capUnload || detailProvider.capLoad ? String(detailProvider.loaded) : "—"} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>Models</span>
                  {detailProvider.models.length === 0 && <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>none</span>}
                  {detailProvider.models.map((m) => (
                    <div key={m.name} className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1.5" style={{ borderColor: "var(--border-subtle)" }}>
                      <span className="truncate text-[var(--text-primary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{m.name}</span>
                      {m.size && <span className="shrink-0 text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{m.size}</span>}
                      {m.loaded && <Badge tone="accent" variant="solid" className="shrink-0">loaded</Badge>}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void providerAction(detailProvider.id, m.loaded ? "unload" : "load", m.name)}
                        disabled={m.loaded ? !detailProvider.capUnload : !detailProvider.capLoad}
                        className="ml-auto shrink-0"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {m.loaded ? "unload" : "load"}
                      </Button>
                    </div>
                  ))}
                </div>

                {detailProvider.howTo && (
                  <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                    <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>Start it</span>
                    <code className="block overflow-x-auto rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-secondary)]" style={{ background: "var(--bg-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>{detailProvider.howTo}</code>
                  </div>
                )}
              </>
            )}

            {detail === "hardware" && (
              <>
                {!ledger && <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>Reading VRAM…</span>}
                {ledger && (
                  <>
                    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border-subtle)" }}>
                      <div className="text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}>GPU memory</div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                        <div className="h-full rounded-full" style={{ width: `${ledger.totalMb ? Math.round((ledger.usedMb / ledger.totalMb) * 100) : 0}%`, background: "rgb(var(--accent-rgb))" }} />
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <Stat label="Used" value={`${fmtGb(ledger.usedMb)} / ${fmtGb(ledger.totalMb)}`} />
                        <Stat label="Free" value={fmtGb(ledger.freeMb)} />
                        <Stat label="Reserve" value={fmtGb(ledger.reserveMb)} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>Top processes</span>
                      {ledger.processes.length === 0 && <span className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>none</span>}
                      {ledger.processes.map((pr) => (
                        <div key={pr.pid} className="flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                          <span className="text-[var(--text-secondary)]">{pr.processName}</span>
                          <span className="text-[var(--text-muted)]">{pr.pid}</span>
                          <span className="ml-auto text-[var(--text-secondary)]">{fmtGb(pr.usedMemoryMb)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <label className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>VRAM reserve (MB)</span>
                  <NumberField value={prefs.vramReserveMb} onChange={(v) => updatePrefs({ vramReserveMb: v })} min={0} max={16384} step={512} ariaLabel="VRAM reserve" />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)" }}>Power metrics</span>
                  <Toggle checked={prefs.powerMetrics} onChange={(v) => updatePrefs({ powerMetrics: v })} label="Power metrics" />
                </div>

                <Button variant="accent" size="sm" onClick={() => void freeGpu()} className="mt-1 w-full py-1.5" style={{ fontFamily: "var(--font-mono)" }}>
                  Free GPU memory
                </Button>
              </>
            )}

            {detail === "glyph" && (
              <>
                <p className="text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)", lineHeight: "var(--lh-body, 1.6)" }}>
                  A compact notation the deck uses for <strong className="text-[var(--text-primary)]">tool results</strong> before they enter the model's context — trading JSON's brackets and repeated field names for far fewer tokens.
                </p>
                <div>
                  <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", letterSpacing: "var(--tracking-label, 0.04em)" }}>How it works</span>
                  <p className="mt-1 text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)", lineHeight: "var(--lh-body, 1.6)" }}>
                    Arrays of uniform objects render as a single table (<code style={{ fontFamily: "var(--font-mono)" }}>@tab[…]</code>); scalars become single symbols. The model reads it natively.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="text-[var(--text-secondary)]" style={{ fontSize: "var(--font-size-sm)" }}>Enabled</span>
                  <Toggle checked={prefs.glyphEncoding} onChange={(v) => updatePrefs({ glyphEncoding: v })} label="Glyph encoding" />
                </div>
              </>
            )}
          </DetailPanel>
        )}
      </div>
    </div>
  );
}
