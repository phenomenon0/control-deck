"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

type ModalityId =
  | "text"
  | "vision"
  | "image-gen"
  | "audio-gen"
  | "tts"
  | "stt"
  | "embedding"
  | "rerank"
  | "3d-gen"
  | "video-gen";

interface ProviderEntry {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseURL?: string;
  defaultModels: string[];
}

interface ModalityMeta {
  id: ModalityId;
  name: string;
  description: string;
  slots: string[];
}

interface SlotBinding {
  modality: ModalityId;
  slotName: string;
  providerId: string;
  config: {
    providerId: string;
    apiKey?: string;
    baseURL?: string;
    model?: string;
    extras?: Record<string, unknown>;
  };
}

interface ProvidersResponse {
  modalities: ModalityMeta[];
  providers: Record<ModalityId, ProviderEntry[]>;
}

interface BindingsResponse {
  persisted: SlotBinding[];
  effective: Record<string, SlotBinding | null>;
}

const PALETTE = {
  border: "var(--border, rgba(255,255,255,0.08))",
  textPrimary: "var(--text-primary, #e7e7ea)",
  textSecondary: "var(--text-secondary, #8a8a93)",
  accent: "var(--accent, #6aa3ff)",
  inputBg: "var(--input-bg, rgba(255,255,255,0.04))",
};

export function ModalitiesPanel() {
  const [catalog, setCatalog] = useState<ProvidersResponse | null>(null);
  const [bindings, setBindings] = useState<BindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, bindRes] = await Promise.all([
        fetch("/api/inference/providers", { cache: "no-store" }),
        fetch("/api/inference/bindings", { cache: "no-store" }),
      ]);
      if (!provRes.ok) throw new Error(`providers ${provRes.status}`);
      if (!bindRes.ok) throw new Error(`bindings ${bindRes.status}`);
      const prov = (await provRes.json()) as ProvidersResponse;
      const bind = (await bindRes.json()) as BindingsResponse;
      setCatalog(prov);
      setBindings(bind);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !catalog) {
    return (
      <div style={{ fontSize: 13, color: PALETTE.textSecondary, padding: "8px 0" }}>
        Loading modality catalog…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ fontSize: 13, color: "#e88", padding: "8px 0" }}>
        Error loading: {error}
      </div>
    );
  }
  if (!catalog || !bindings) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {catalog.modalities.map((meta) => (
        <ModalityRow
          key={meta.id}
          meta={meta}
          providers={catalog.providers[meta.id] ?? []}
          effective={bindings.effective[`${meta.id}::primary`] ?? null}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function ModalityRow({
  meta,
  providers,
  effective,
  onChanged,
}: {
  meta: ModalityMeta;
  providers: ProviderEntry[];
  effective: SlotBinding | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const bound = effective;
  const boundProvider = providers.find((p) => p.id === bound?.providerId);

  return (
    <div
      style={{
        border: `1px solid ${PALETTE.border}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: PALETTE.textPrimary,
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</span>
          <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>
            {providers.length} provider{providers.length === 1 ? "" : "s"}
          </span>
        </span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <StatusBadge bound={bound} providerName={boundProvider?.name} />
          <ChevronDown
            size={14}
            style={{
              transform: `rotate(${open ? 180 : 0}deg)`,
              transition: "transform 0.12s",
              color: PALETTE.textSecondary,
            }}
          />
        </span>
      </button>
      {open && (
        <div style={{ padding: "6px 12px 14px 12px", borderTop: `1px solid ${PALETTE.border}` }}>
          <p style={{ fontSize: 11, color: PALETTE.textSecondary, margin: "0 0 10px 0" }}>
            {meta.description}
          </p>
          <ModalityEditor
            meta={meta}
            providers={providers}
            current={bound}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  bound,
  providerName,
}: {
  bound: SlotBinding | null;
  providerName: string | undefined;
}) {
  if (!bound) {
    return (
      <span style={{ fontSize: 10, color: PALETTE.textSecondary, fontStyle: "italic" }}>
        unbound
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: PALETTE.accent }}>
      {providerName ?? bound.providerId}
      {bound.config.model ? ` · ${bound.config.model}` : ""}
    </span>
  );
}

function ModalityEditor({
  meta,
  providers,
  current,
  onChanged,
}: {
  meta: ModalityMeta;
  providers: ProviderEntry[];
  current: SlotBinding | null;
  onChanged: () => void;
}) {
  const [providerId, setProviderId] = useState(current?.providerId ?? providers[0]?.id ?? "");
  const [model, setModel] = useState(current?.config.model ?? "");
  const [apiKey, setApiKey] = useState(current?.config.apiKey ?? "");
  const [baseURL, setBaseURL] = useState(current?.config.baseURL ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId],
  );

  // Reset model when provider changes and the previous model doesn't belong.
  useEffect(() => {
    if (!selected) return;
    if (selected.defaultModels.length > 0 && !selected.defaultModels.includes(model)) {
      setModel(selected.defaultModels[0] ?? "");
    }
  }, [selected, model]);

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const body: SlotBinding = {
        modality: meta.id,
        slotName: "primary",
        providerId: selected.id,
        config: {
          providerId: selected.id,
          model: model || undefined,
          apiKey: apiKey || undefined,
          baseURL: baseURL || undefined,
        },
      };
      const res = await fetch("/api/inference/bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `save ${res.status}`);
      setMsg("Saved");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2000);
    }
  }, [selected, model, apiKey, baseURL, meta.id, onChanged]);

  const clearBinding = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/inference/bindings?modality=${encodeURIComponent(meta.id)}&slot=primary`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`clear ${res.status}`);
      setMsg("Cleared — reverted to env default");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "clear failed");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2000);
    }
  }, [meta.id, onChanged]);

  if (providers.length === 0) {
    return (
      <p style={{ fontSize: 12, color: PALETTE.textSecondary, fontStyle: "italic" }}>
        No providers registered for this modality yet.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="Provider">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          style={inputStyle}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.requiresApiKey ? "· key" : "· local"}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model">
        {selected && selected.defaultModels.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={inputStyle}
          >
            <option value="">— default —</option>
            {selected.defaultModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="(leave blank for provider default)"
            style={inputStyle}
          />
        )}
      </Field>

      {selected?.requiresApiKey && (
        <Field label="API key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="leave blank to use env var"
            style={inputStyle}
            autoComplete="new-password"
          />
        </Field>
      )}

      {!selected?.requiresApiKey && (
        <Field label="Base URL">
          <input
            type="text"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={selected?.defaultBaseURL ?? ""}
            style={inputStyle}
          />
        </Field>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            ...buttonStyle,
            background: PALETTE.accent,
            color: "#fff",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={clearBinding}
          disabled={saving}
          style={{
            ...buttonStyle,
            background: "transparent",
            color: PALETTE.textSecondary,
            border: `1px solid ${PALETTE.border}`,
          }}
        >
          Clear
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>{msg}</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: PALETTE.inputBg,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
  color: PALETTE.textPrimary,
  outline: "none",
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
};
