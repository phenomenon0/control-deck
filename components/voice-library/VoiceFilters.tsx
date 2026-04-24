"use client";

interface VoiceFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  tag: string;
  onTagChange: (value: string) => void;
  providerId: string;
  onProviderChange: (value: string) => void;
  /** Language + tag + provider options derived from the current asset list. */
  facets: {
    languages: string[];
    tags: string[];
    providers: string[];
  };
}

export function VoiceFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  language,
  onLanguageChange,
  tag,
  onTagChange,
  providerId,
  onProviderChange,
  facets,
}: VoiceFiltersProps) {
  const anyActive = Boolean(search || status || language || tag || providerId);
  return (
    <div className="card space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_160px_180px]">
        <input
          className="input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search voice assets"
        />
        <select className="input" value={status} onChange={(e) => onStatusChange(e.target.value)}>
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="restricted">Restricted</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select className="input" value={language} onChange={(e) => onLanguageChange(e.target.value)}>
          <option value="">Any language</option>
          {facets.languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select className="input" value={tag} onChange={(e) => onTagChange(e.target.value)}>
          <option value="">Any tag</option>
          {facets.tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="input" value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
          <option value="">Any provider</option>
          {facets.providers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      {anyActive ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => {
              onSearchChange("");
              onStatusChange("");
              onLanguageChange("");
              onTagChange("");
              onProviderChange("");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </div>
  );
}
