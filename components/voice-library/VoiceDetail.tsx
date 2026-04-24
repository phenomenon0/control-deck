"use client";

interface VoiceDetailProps {
  detail: {
    asset: {
      id: string;
      name: string;
      status: string;
      providerId: string | null;
      engineId: string | null;
      language: string | null;
      accent: string | null;
      gender: string | null;
      owner: string | null;
      description: string | null;
      styleTags: string[];
      consentStatus: string;
      rightsStatus: string;
    };
    references: Array<{ id: string; artifact: { url: string; name: string } | null; speakerName: string | null; transcript: string | null }>;
    previews: Array<{ id: string; promptText: string; artifact: { url: string; name: string } | null }>;
  };
  isActive?: boolean;
  onUseInLive?: () => void;
  onAction: (action: "publish" | "restrict" | "archive") => Promise<void> | void;
  onDesignInStudio?: () => void;
  /** @deprecated use onUseInLive */
  onUseInAssistant?: () => void;
}

export function VoiceDetail({
  detail,
  isActive = false,
  onUseInLive,
  onAction,
  onDesignInStudio,
  onUseInAssistant,
}: VoiceDetailProps) {
  const { asset } = detail;
  const useInLive = onUseInLive ?? onUseInAssistant;

  return (
    <div className="card space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label">Voice detail</div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{asset.name}</h3>
          {asset.description ? <p className="text-sm text-[var(--text-muted)] mt-2">{asset.description}</p> : null}
        </div>
        <span className="pill--mono">{asset.status}</span>
      </div>

      {/* Primary action — dominant CTA */}
      {useInLive ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={useInLive}
          disabled={isActive}
        >
          {isActive ? "Currently live" : "Use in Live"}
        </button>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 text-sm">
        <div className="card-sub">
          <div className="text-xs text-[var(--text-muted)]">Provider</div>
          <div className="text-[var(--text-primary)]">{asset.providerId ?? "—"}</div>
        </div>
        <div className="card-sub">
          <div className="text-xs text-[var(--text-muted)]">Engine</div>
          <div className="text-[var(--text-primary)]">{asset.engineId ?? "—"}</div>
        </div>
        <div className="card-sub">
          <div className="text-xs text-[var(--text-muted)]">Language / accent</div>
          <div className="text-[var(--text-primary)]">{asset.language ?? "—"}{asset.accent ? ` · ${asset.accent}` : ""}</div>
        </div>
        <div className="card-sub">
          <div className="text-xs text-[var(--text-muted)]">Governance</div>
          <div className="text-[var(--text-primary)]">{asset.consentStatus} · {asset.rightsStatus}</div>
        </div>
      </div>

      {asset.styleTags.length ? (
        <div className="flex flex-wrap gap-2">
          {asset.styleTags.map((tag) => (
            <span key={tag} className="pill--mono">{tag}</span>
          ))}
        </div>
      ) : null}

      {/* Secondary + governance actions */}
      <div className="flex flex-wrap gap-2">
        {onDesignInStudio ? (
          <button className="btn btn-secondary" onClick={onDesignInStudio}>Design in Studio →</button>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn btn-secondary text-xs" onClick={() => void onAction("publish")}>Publish</button>
          <button className="btn btn-secondary text-xs" onClick={() => void onAction("restrict")}>Restrict</button>
          <button className="btn btn-secondary text-xs" onClick={() => void onAction("archive")}>Archive</button>
        </div>
      </div>

      {detail.previews.length ? (
        <div className="space-y-3">
          <div className="text-sm font-medium text-[var(--text-primary)]">Previews</div>
          {detail.previews.map((preview) => (
            <div key={preview.id} className="card-sub space-y-2">
              <div className="text-xs text-[var(--text-muted)]">{preview.promptText}</div>
              {preview.artifact ? <audio controls className="w-full" src={preview.artifact.url} preload="none" /> : null}
            </div>
          ))}
        </div>
      ) : null}

      {detail.references.length ? (
        <div className="space-y-3">
          <div className="text-sm font-medium text-[var(--text-primary)]">References</div>
          {detail.references.map((reference) => (
            <div key={reference.id} className="card-sub space-y-2">
              <div className="text-xs text-[var(--text-muted)]">{reference.speakerName || "Reference clip"}</div>
              {reference.transcript ? <div className="text-xs text-[var(--text-muted)]">{reference.transcript}</div> : null}
              {reference.artifact ? <audio controls className="w-full" src={reference.artifact.url} preload="none" /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
