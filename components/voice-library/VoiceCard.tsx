"use client";

interface VoiceAsset {
  id: string;
  name: string;
  status: string;
  providerId: string | null;
  engineId: string | null;
  language: string | null;
  styleTags: string[];
  description: string | null;
}

interface VoiceCardProps {
  asset: VoiceAsset;
  selected: boolean;
  isActive?: boolean;
  onSelect: () => void;
  onUseInLive?: () => void;
  onPreview?: () => void;
}

export function VoiceCard({
  asset,
  selected,
  isActive = false,
  onSelect,
  onUseInLive,
  onPreview,
}: VoiceCardProps) {
  return (
    <div
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)]"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">{asset.name}</div>
              {isActive ? (
                <span className="pill--mono" style={{ color: "var(--success)", borderColor: "var(--success)" }}>
                  live
                </span>
              ) : null}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              {asset.providerId ?? "no-provider"}
              {asset.engineId ? ` · ${asset.engineId}` : ""}
              {asset.language ? ` · ${asset.language}` : ""}
            </div>
          </div>
          <span className="pill--mono">{asset.status}</span>
        </div>
        {asset.description ? (
          <div className="text-xs text-[var(--text-muted)] mt-3 line-clamp-2">{asset.description}</div>
        ) : null}
        {asset.styleTags.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {asset.styleTags.slice(0, 4).map((tag) => (
              <span key={tag} className="pill--mono">{tag}</span>
            ))}
          </div>
        ) : null}
      </button>
      {(onUseInLive || onPreview) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onUseInLive ? (
            <button
              type="button"
              className="btn btn-primary py-1 px-3 text-xs"
              onClick={onUseInLive}
              disabled={isActive}
            >
              {isActive ? "In use" : "Use in Live"}
            </button>
          ) : null}
          {onPreview ? (
            <button type="button" className="btn btn-secondary py-1 px-3 text-xs" onClick={onPreview}>
              Preview
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
