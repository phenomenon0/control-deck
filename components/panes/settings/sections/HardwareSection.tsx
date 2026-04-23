"use client";

import { useState } from "react";
import type { HardwareSettings, SettingsProviderId } from "@/lib/settings/schema";
import { NumberInput, Panel, Row, SectionHeader, TextInput, Toggle } from "../shared/FormBits";

const PROVIDER_ROWS: Array<{
  id: SettingsProviderId;
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    id: "ollama",
    label: "Ollama",
    placeholder: "http://localhost:11434",
    hint: "Native API; fallback to OLLAMA_BASE_URL env then localhost.",
  },
  {
    id: "vllm",
    label: "vLLM",
    placeholder: "http://localhost:8000",
    hint: "OpenAI-compat at /v1/models. Env: VLLM_BASE_URL.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    placeholder: "http://localhost:8080",
    hint: "llama.cpp server's /v1/models. Env: LLAMACPP_BASE_URL.",
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    placeholder: "http://localhost:1234",
    hint: "Richer /api/v0/models + loaded state. Env: LM_STUDIO_BASE_URL.",
  },
  {
    id: "comfyui",
    label: "ComfyUI",
    placeholder: "http://localhost:8188",
    hint: "Reads /object_info for checkpoints. Env: COMFYUI_BASE_URL.",
  },
];

/**
 * Hardware settings section — everything that drives /deck/hardware:
 * per-provider URLs, which providers the registry probes, the VRAM reserve
 * used by the fit check, and the extra search roots walked by the offline
 * scanner.
 */
export function HardwareSection({
  value,
  onChange,
}: {
  value: HardwareSettings;
  onChange: (partial: Partial<HardwareSettings>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Hardware & Providers"
        description="Which inference servers the Hardware pane probes, where to find them, and how much VRAM to keep free."
      />

      <Panel title="Enabled providers">
        <div className="settings-row">
          <div className="settings-row-text">
            <label>Probe set</label>
            <span className="settings-row-hint">
              Disabled providers aren't probed at all — saves a round-trip per page load. Re-enable any
              time to see their model lists under <code>/deck/hardware?tab=providers</code>.
            </span>
          </div>
        </div>
        {PROVIDER_ROWS.map((p) => {
          const enabled = value.enabledProviders.includes(p.id);
          return (
            <Row key={p.id} label={p.label} hint={p.hint}>
              <Toggle
                checked={enabled}
                onChange={(v) =>
                  onChange({
                    enabledProviders: v
                      ? [...value.enabledProviders, p.id]
                      : value.enabledProviders.filter((id) => id !== p.id),
                  })
                }
              />
            </Row>
          );
        })}
      </Panel>

      <Panel title="Base URLs">
        <div className="settings-row">
          <div className="settings-row-text">
            <label>Resolution order</label>
            <span className="settings-row-hint">
              Empty field → falls back to the provider's env var → then localhost default. The URL
              shown on the Providers tab is the one this resolver picks.
            </span>
          </div>
        </div>
        {PROVIDER_ROWS.map((p) => (
          <Row key={p.id} label={`${p.label} URL`} hint={p.placeholder}>
            <TextInput
              value={value.providerUrls[p.id]}
              onChange={(v) =>
                onChange({
                  providerUrls: { ...value.providerUrls, [p.id]: v },
                })
              }
              placeholder={p.placeholder}
            />
          </Row>
        ))}
      </Panel>

      <Panel title="VRAM budget">
        <Row
          label="Reserve (MB)"
          hint="Kept free when deciding whether a model will fit. The Fit badge flips to amber when loading the model would leave less than this."
        >
          <NumberInput
            value={value.vramReserveMb}
            onChange={(v) => onChange({ vramReserveMb: v ?? 2048 })}
            min={0}
            max={65536}
            step={256}
          />
        </Row>
      </Panel>

      <Panel title="Offline scanner roots">
        <div className="settings-row">
          <div className="settings-row-text">
            <label>Extra GGUF directories</label>
            <span className="settings-row-hint">
              Added to the always-scanned list (<code>~/Models</code>, <code>~/.local/share/models</code>,{" "}
              <code>~/llama.cpp/models</code>). Used when Ollama/vLLM are stopped to still surface
              what's on disk.
            </span>
          </div>
        </div>
        <GgufRootsEditor
          roots={value.ggufSearchRoots}
          onChange={(next) => onChange({ ggufSearchRoots: next })}
        />
      </Panel>
    </>
  );
}

function GgufRootsEditor({
  roots,
  onChange,
}: {
  roots: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="settings-roots-editor">
      {roots.length === 0 ? (
        <div className="settings-roots-empty">
          Only the built-in paths are scanned right now. Add a custom GGUF dir to extend.
        </div>
      ) : (
        <ul className="settings-roots-list">
          {roots.map((r) => (
            <li key={r} className="settings-roots-row">
              <code>{r}</code>
              <button
                type="button"
                className="settings-reset"
                onClick={() => onChange(roots.filter((x) => x !== r))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-roots-add">
        <input
          className="settings-input"
          placeholder="/absolute/path or ~/Models"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...roots, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          className="settings-reset"
          disabled={!draft.trim()}
          onClick={() => {
            onChange([...roots, draft.trim()]);
            setDraft("");
          }}
        >
          Add root
        </button>
      </div>
    </div>
  );
}
