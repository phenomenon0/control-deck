"use client";

/**
 * /v2/hardware — Atlas Visual 2 HARDWARE surface. A full hardware monitor,
 * fuller than the models VRAM panel: GPU, CPU, RAM, DISK, plus loaded models
 * and runtime processes, refreshed every 5s.
 *
 * Real data (polled every 5s):
 *   · /api/system/stats            — live GPU (name, VRAM used/total, util, temp)
 *                                    and background service/process statuses.
 *   · /api/inference/system-profile — rig capacities (CPU model/cores, RAM total,
 *                                    disk free/total, backend, mode) + installed
 *                                    Ollama models.
 *
 * Honest gaps: neither endpoint samples GPU power draw, live CPU load %, or live
 * RAM-used, so those render as an explicit "not sampled" state rather than faked
 * telemetry. VRAM and DISK carry the real used/total meters, semantic-red at
 * critical. Realistic sample values seed the first paint / any fetch outage, and
 * are clearly tagged as sample until a poll succeeds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./hardware-v2.css";

/* ── types (mirror the two endpoint payloads) ─────────────────────────────── */
interface GpuStats {
  name: string; memoryUsed: number; memoryTotal: number;
  memoryPercent: number; utilization: number; temperature: number;
}
interface ServiceStatus {
  name: string; url: string; status: "online" | "offline" | "unknown";
  latencyMs?: number;
}
interface GpuInfo { name: string; vram: number; unifiedMemory?: boolean }
interface StorageInfo { freeGb: number; totalGb: number }
interface SystemProfile {
  mode: string; gpu: GpuInfo | null; ram: number; cpuCores: number;
  cpuModel: string; isIntel: boolean; platform: string; backend: string;
  storage: StorageInfo | null;
}
interface InstalledModel { name: string; sizeBytes: number; family?: string; quantization?: string }

/* ── realistic seed (RTX 3090 rig) — flagged `sample` until a poll lands ───── */
const SEED_GPU: GpuStats = {
  name: "NVIDIA GeForce RTX 3090", memoryUsed: 8240, memoryTotal: 24576,
  memoryPercent: 34, utilization: 11, temperature: 42,
};
const SEED_PROFILE: SystemProfile = {
  mode: "power",
  gpu: { name: "NVIDIA GeForce RTX 3090", vram: 24576 },
  ram: 64, cpuCores: 16, cpuModel: "AMD Ryzen 9 5950X 16-Core Processor",
  isIntel: false, platform: "linux", backend: "cuda",
  storage: { freeGb: 812, totalGb: 1863 },
};
const SEED_SERVICES: ServiceStatus[] = [
  { name: "Ollama", url: "http://localhost:11434/api/tags", status: "online", latencyMs: 4 },
  { name: "ComfyUI", url: "http://127.0.0.1:8188/system_stats", status: "online", latencyMs: 12 },
  { name: "Terminal Service", url: "http://127.0.0.1:4010/health", status: "online", latencyMs: 3 },
  { name: "VectorDB", url: "http://localhost:4242", status: "online", latencyMs: 6 },
  { name: "SearxNG", url: "http://localhost:8888/healthz", status: "offline" },
  { name: "Voice Core", url: "http://127.0.0.1:4245/health", status: "offline" },
];

/* ── helpers ──────────────────────────────────────────────────────────────── */
const GIB = 1073741824;
const mbToGb = (mb: number) => mb / 1024;
const fx = (n: number, d = 1) => n.toFixed(d);
type Level = "ok" | "caution" | "danger";
const meterCls = (lvl: Level) => `meter${lvl === "danger" ? " meter--danger" : lvl === "caution" ? " meter--caution" : ""}`;

function shortCpu(model: string): string {
  return model
    .replace(/\((R|TM|C)\)/gi, "")
    .replace(/\d+-Core Processor/i, "")
    .replace(/CPU\s*@.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function HardwarePage() {
  const [gpu, setGpu] = useState<GpuStats | null>(SEED_GPU);
  const [services, setServices] = useState<ServiceStatus[]>(SEED_SERVICES);
  const [profile, setProfile] = useState<SystemProfile | null>(SEED_PROFILE);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [live, setLive] = useState(false);   // a poll has succeeded at least once
  const [stale, setStale] = useState(false); // last poll failed
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const gpuLiveRef = useRef(false);

  const refresh = useCallback(async () => {
    let anyOk = false;
    try {
      const [sr, pr] = await Promise.all([
        fetch("/api/system/stats", { cache: "no-store" }),
        fetch("/api/inference/system-profile", { cache: "no-store" }),
      ]);
      if (sr.ok) {
        const sd = (await sr.json()) as { gpu: GpuStats | null; services?: ServiceStatus[] };
        setGpu(sd.gpu ?? null);
        gpuLiveRef.current = !!sd.gpu;
        if (Array.isArray(sd.services)) setServices(sd.services);
        anyOk = true;
      }
      if (pr.ok) {
        const pd = (await pr.json()) as { profile?: SystemProfile; installed?: InstalledModel[] };
        if (pd.profile) setProfile(pd.profile);
        if (Array.isArray(pd.installed)) setInstalled(pd.installed);
        anyOk = true;
      }
    } catch {
      /* keep last-known data */
    }
    if (anyOk) { setLive(true); setStale(false); setUpdatedAt(Date.now()); }
    else setStale(true);
  }, []);

  // poll both endpoints every 5s
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // 1s ticker so the "updated Ns ago" label counts up between polls
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── GPU derived ── */
  const gpuLive = gpuLiveRef.current;
  const gpuName = gpu?.name ?? profile?.gpu?.name ?? "No GPU detected";
  const vramTotalMb = gpu?.memoryTotal ?? profile?.gpu?.vram ?? 0;
  const vramUsedMb = gpuLive ? (gpu?.memoryUsed ?? 0) : null;
  const vramPct = gpuLive && vramTotalMb > 0
    ? (gpu?.memoryPercent ?? Math.round(((gpu?.memoryUsed ?? 0) / vramTotalMb) * 100))
    : null;
  const vramLevel: Level = vramPct == null ? "ok" : vramPct >= 92 ? "danger" : vramPct >= 78 ? "caution" : "ok";
  const util = gpuLive ? gpu?.utilization ?? 0 : null;
  const temp = gpuLive ? gpu?.temperature ?? 0 : null;
  const tempLevel: Level = temp == null ? "ok" : temp >= 84 ? "danger" : temp >= 72 ? "caution" : "ok";

  /* ── DISK derived (real) ── */
  const disk = profile?.storage ?? null;
  const diskUsedGb = disk ? Math.max(0, disk.totalGb - disk.freeGb) : 0;
  const diskUsedPct = disk && disk.totalGb > 0 ? (diskUsedGb / disk.totalGb) * 100 : 0;
  const freePct = disk && disk.totalGb > 0 ? (disk.freeGb / disk.totalGb) * 100 : 100;
  const diskLevel: Level = freePct < 8 ? "danger" : freePct < 16 ? "caution" : "ok";

  /* ── loaded models sorted big-first ── */
  const models = useMemo(
    () => [...installed].sort((a, b) => b.sizeBytes - a.sizeBytes),
    [installed],
  );
  const onlineCount = services.filter((s) => s.status === "online").length;

  /* ── status chip ── */
  const agoSec = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  let chipCls = "status-chip", chipDot = "dot", chipText: string;
  if (!live) { chipCls += " status-chip--sample"; chipText = "sample data · connecting"; }
  else if (stale) { chipCls += " status-chip--stale"; chipDot += ""; chipText = "reconnecting"; }
  else { chipDot += " live"; chipText = agoSec === 0 ? "live · just now" : `live · updated ${agoSec}s ago`; }

  return (
    <div className="av2-hardware">
      <div className="wrap">
        {/* hero */}
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">System · {profile?.platform ?? "host"} · {profile?.mode ?? "—"} mode</span>
            <h1>Hardware</h1>
            <p>Live telemetry for the inference rig — GPU, CPU, memory, and disk,
              refreshed every five seconds, with loaded models and background
              processes at a glance.</p>
          </div>
          <div className="hero-side">
            <span className={chipCls}><span className={chipDot} />{chipText}</span>
            <span className="status-chip">
              {profile?.backend?.toUpperCase() ?? "CPU"} · {onlineCount}/{services.length} services
            </span>
          </div>
        </header>

        {/* GPU feature panel */}
        <section className="card gpu">
          <div className="gpu-head">
            <div className="gpu-id">
              <span className="kicker">GPU 0</span>
              <h2>{gpuName}</h2>
              <div className="tags">
                <span className="tag tag--accent">{(profile?.backend ?? "cuda").toUpperCase()}</span>
                {profile?.gpu?.unifiedMemory && <span className="tag">unified</span>}
                <span className={`tag tag--status ${gpuLive ? "tag--positive" : "tag--caution"}`}>
                  {gpuLive ? "live" : "no live telemetry"}
                </span>
              </div>
            </div>
            <div className="gpu-read">
              <div className="big">
                <b>{vramUsedMb != null ? fx(mbToGb(vramUsedMb)) : "—"}</b>
                <i>/ {vramTotalMb ? fx(mbToGb(vramTotalMb), 0) : "—"} GB</i>
              </div>
              <div className={`pct${vramLevel === "danger" ? " crit" : vramLevel === "caution" ? " warn" : ""}`}>
                {vramPct != null ? `${vramPct}% VRAM in use` : "VRAM usage not sampled"}
              </div>
            </div>
          </div>

          <div className="meter-label">
            <span>VRAM</span>
            <b>{vramUsedMb != null ? `${fx(mbToGb(vramUsedMb))} / ${fx(mbToGb(vramTotalMb), 0)} GB` : "— / " + (vramTotalMb ? fx(mbToGb(vramTotalMb), 0) : "—") + " GB"}</b>
          </div>
          <div className={vramPct == null ? "meter meter--tall meter--unsampled" : `${meterCls(vramLevel)} meter--tall`}>
            <div className="meter-fill" style={{ width: `${vramPct ?? 0}%` }} />
          </div>

          <div className="gpu-cells">
            <div className="cell">
              <span className="k">Utilization</span>
              <span className={`v${util == null ? " na" : ""}`}>
                {util != null ? <>{util}<i>%</i></> : "—"}
              </span>
              <div className={util == null ? "meter meter--unsampled" : "meter"}>
                <div className="meter-fill" style={{ width: `${util ?? 0}%` }} />
              </div>
            </div>
            <div className="cell">
              <span className="k">Temperature</span>
              <span className={`v${temp == null ? " na" : tempLevel === "danger" ? " crit" : tempLevel === "caution" ? " warn" : ""}`}>
                {temp != null ? <>{temp}<i>°C</i></> : "—"}
              </span>
              <span className="note">{temp != null ? "core" : "not sampled"}</span>
            </div>
            <div className="cell">
              <span className="k">Power draw</span>
              <span className="v na">—</span>
              <span className="note">not sampled by host</span>
            </div>
          </div>
        </section>

        {/* CPU · RAM · DISK */}
        <section className="res-grid">
          {/* CPU */}
          <div className="card res">
            <div className="res-head"><span className="kicker">CPU</span></div>
            <div className="res-sub-id" title={profile?.cpuModel}>{profile ? shortCpu(profile.cpuModel) : "—"}</div>
            <div className="res-big"><b>{profile?.cpuCores ?? "—"}</b><i>logical cores</i></div>
            <div className="meter meter--unsampled"><div className="meter-fill" /></div>
            <span className="meter-cap">load not sampled by host</span>
            <div className="res-foot">
              <span><em>backend</em> <b>{(profile?.backend ?? "cpu").toUpperCase()}</b></span>
              <span><em>arch</em> <b>{profile?.isIntel ? "Intel" : "non-Intel"}</b></span>
            </div>
          </div>

          {/* RAM */}
          <div className="card res">
            <div className="res-head"><span className="kicker">System RAM</span></div>
            <div className="res-sub-id">total installed memory</div>
            <div className="res-big"><b>{profile?.ram ?? "—"}</b><i>GB total</i></div>
            <div className="meter meter--unsampled"><div className="meter-fill" /></div>
            <span className="meter-cap">live usage not sampled by host</span>
            <div className="res-foot">
              <span><em>per core</em> <b>{profile && profile.cpuCores ? fx(profile.ram / profile.cpuCores, 1) : "—"} GB</b></span>
              <span><em>mode</em> <b>{profile?.mode ?? "—"}</b></span>
            </div>
          </div>

          {/* DISK */}
          <div className="card res">
            <div className="res-head"><span className="kicker">Disk · home volume</span></div>
            <div className="res-sub-id">available capacity</div>
            <div className="res-big">
              <b className={diskLevel === "danger" ? "crit" : diskLevel === "caution" ? "warn" : ""}>
                {disk ? fx(disk.freeGb, 0) : "—"}
              </b>
              <i>GB free</i>
            </div>
            <div className={disk ? `${meterCls(diskLevel)}` : "meter meter--unsampled"}>
              <div className="meter-fill" style={{ width: `${diskUsedPct}%` }} />
            </div>
            <span className={`meter-cap${diskLevel === "danger" ? " crit" : diskLevel === "caution" ? " warn" : ""}`}>
              {disk ? `${fx(diskUsedGb, 0)} / ${fx(disk.totalGb, 0)} GB used · ${fx(freePct, 0)}% free` : "storage unavailable"}
            </span>
            <div className="res-foot">
              <span><em>used</em> <b>{disk ? `${fx(diskUsedPct, 0)}%` : "—"}</b></span>
              {diskLevel === "danger" && <span><em>status</em> <b>low space</b></span>}
            </div>
          </div>
        </section>

        {/* loaded models · processes */}
        <section className="lists">
          <div className="card listcard">
            <div className="list-head">
              <h3>Loaded Models</h3>
              <span className="count">{models.length}</span>
            </div>
            {models.length === 0 ? (
              <div className="empty">No models installed — Ollama offline or empty.</div>
            ) : (
              <div className="rows">
                {models.map((m) => (
                  <div className="lrow" key={m.name}>
                    <div className="lmain">
                      <div className="lname" title={m.name}>{m.name}</div>
                      {(m.family || m.quantization) && (
                        <div className="lmeta">
                          {m.family && <span className="tag">{m.family}</span>}
                          {m.quantization && <span className="tag">{m.quantization}</span>}
                        </div>
                      )}
                    </div>
                    <span className="lsize">{fx(m.sizeBytes / GIB)} GB</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card listcard">
            <div className="list-head">
              <h3>Processes</h3>
              <span className="count">{onlineCount}/{services.length} up</span>
            </div>
            <div className="rows">
              {services.map((s) => (
                <div className="lrow prow" key={s.name}>
                  <span className={`pdot ${s.status}`} />
                  <div className="lmain">
                    <div className="lname">{s.name}</div>
                    <div className="purl" title={s.url}>{s.url.replace(/^https?:\/\//, "")}</div>
                  </div>
                  <span className={`platency${s.status === "online" ? "" : " off"}`}>
                    {s.status === "online" ? `${s.latencyMs ?? 0} ms` : s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="foot">
          <span>Polling <code>/api/system/stats</code> + <code>/api/inference/system-profile</code> every 5s</span>
          <span>{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</span>
        </footer>
      </div>
    </div>
  );
}
