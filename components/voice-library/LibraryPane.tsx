"use client";

/**
 * LibraryPane — the "Voices" tab of /deck/audio.
 *
 * Primary job: help the user pick or audition a voice fast. The dominant CTA
 * on every card is `Use in Live`; governance actions (publish/restrict/archive)
 * stay in the detail pane so they don't clutter the browse flow.
 */

import { useEffect, useMemo, useState } from "react";

import { useVoiceLibrary } from "@/lib/hooks/useVoiceLibrary";
import { useVoiceWorkspace } from "@/lib/hooks/useVoiceWorkspace";

import { VoiceCard } from "./VoiceCard";
import { VoiceDetail } from "./VoiceDetail";
import { VoiceFilters } from "./VoiceFilters";

/** The URL param that records the active live voice — separate from the
 * highlighted inspection target so the user can browse other voices without
 * losing their active assignment. */
const ACTIVE_PARAM = "live-voice";

function useActiveLiveVoice(): [string | null, (id: string | null) => void] {
  // Lightweight localStorage mirror so the active voice survives reloads.
  // Source of truth still lives in the session (and will move to the deck
  // settings provider when T3/T7 complete).
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTIVE_PARAM);
    if (stored) setId(stored);
  }, []);
  const update = (next: string | null) => {
    setId(next);
    if (typeof window === "undefined") return;
    if (next) window.localStorage.setItem(ACTIVE_PARAM, next);
    else window.localStorage.removeItem(ACTIVE_PARAM);
  };
  return [id, update];
}

export function LibraryPane() {
  const workspace = useVoiceWorkspace();
  const selectedId = workspace.assetId;
  const setSelectedId = workspace.setAssetId;
  const [activeVoiceId, setActiveVoiceId] = useActiveLiveVoice();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [language, setLanguage] = useState("");
  const [tag, setTag] = useState("");
  const [providerId, setProviderId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const library = useVoiceLibrary({
    includeDrafts: true,
    assetId: selectedId || null,
    search,
    status: statusFilter,
    language,
    tag,
    providerId,
  });

  const facets = useMemo(() => {
    const languages = new Set<string>();
    const tags = new Set<string>();
    const providers = new Set<string>();
    for (const asset of library.assets) {
      if (asset.language) languages.add(asset.language);
      for (const t of asset.styleTags) tags.add(t);
      if (asset.providerId) providers.add(asset.providerId);
    }
    return {
      languages: [...languages].sort(),
      tags: [...tags].sort(),
      providers: [...providers].sort(),
    };
  }, [library.assets]);

  useEffect(() => {
    if (!selectedId && library.assets[0]?.id) setSelectedId(library.assets[0].id);
  }, [library.assets, selectedId, setSelectedId]);

  async function handleAction(action: "publish" | "restrict" | "archive") {
    if (!selectedId) return;
    const res = await fetch(`/api/voice/library/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error || "Action failed");
      return;
    }
    setActionError(null);
    await Promise.all([library.refreshAssets(), library.refreshDetail()]);
  }

  function handleUseInLive(assetId: string) {
    setActiveVoiceId(assetId);
    workspace.jumpToLive({ assetId });
  }

  // Group: Recommended (approved) / Drafts / Other
  const groups = useMemo(() => {
    const recommended: typeof library.assets = [];
    const drafts: typeof library.assets = [];
    const other: typeof library.assets = [];
    const active: typeof library.assets = [];
    for (const asset of library.assets) {
      if (asset.id === activeVoiceId) active.push(asset);
      else if (asset.status === "approved") recommended.push(asset);
      else if (asset.status === "draft") drafts.push(asset);
      else other.push(asset);
    }
    return { active, recommended, drafts, other };
  }, [library.assets, activeVoiceId]);

  const error = actionError ?? library.error;

  return (
    <div className="h-full overflow-auto px-6 py-5 space-y-6">
      <header className="space-y-2">
        <div className="label">Voices</div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Voices</h1>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          Pick or audition a voice. &ldquo;Use in Live&rdquo; moves the selected voice into your current conversation.
        </p>
      </header>

      <VoiceFilters
        search={search}
        onSearchChange={setSearch}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        language={language}
        onLanguageChange={setLanguage}
        tag={tag}
        onTagChange={setTag}
        providerId={providerId}
        onProviderChange={setProviderId}
        facets={facets}
      />
      {error ? <div className="card text-sm text-[var(--error)]">{error}</div> : null}
      {library.loading ? <div className="card text-sm text-[var(--text-muted)]">Loading voices…</div> : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          {groups.active.length ? (
            <section className="space-y-3">
              <div className="label">Currently live</div>
              {groups.active.map((asset) => (
                <VoiceCard
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedId}
                  isActive={true}
                  onSelect={() => setSelectedId(asset.id)}
                  onUseInLive={() => handleUseInLive(asset.id)}
                />
              ))}
            </section>
          ) : null}

          {groups.recommended.length ? (
            <section className="space-y-3">
              <div className="label">Recommended</div>
              {groups.recommended.map((asset) => (
                <VoiceCard
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedId}
                  isActive={asset.id === activeVoiceId}
                  onSelect={() => setSelectedId(asset.id)}
                  onUseInLive={() => handleUseInLive(asset.id)}
                />
              ))}
            </section>
          ) : null}

          {groups.drafts.length ? (
            <section className="space-y-3">
              <div className="label">Drafts</div>
              {groups.drafts.map((asset) => (
                <VoiceCard
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedId}
                  isActive={asset.id === activeVoiceId}
                  onSelect={() => setSelectedId(asset.id)}
                  onUseInLive={() => handleUseInLive(asset.id)}
                />
              ))}
            </section>
          ) : null}

          {groups.other.length ? (
            <section className="space-y-3">
              <div className="label">Restricted &amp; archived</div>
              {groups.other.map((asset) => (
                <VoiceCard
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedId}
                  isActive={asset.id === activeVoiceId}
                  onSelect={() => setSelectedId(asset.id)}
                />
              ))}
            </section>
          ) : null}

          {library.assets.length === 0 && !library.loading ? (
            <div className="card text-sm text-[var(--text-muted)]">
              No voice assets found. Open Studio to draft one.
            </div>
          ) : null}
        </div>

        {library.detail ? (
          <VoiceDetail
            detail={library.detail}
            isActive={library.detail.asset.id === activeVoiceId}
            onUseInLive={() => handleUseInLive(library.detail!.asset.id)}
            onAction={handleAction}
            onDesignInStudio={() => workspace.jumpToStudio({ assetId: library.detail!.asset.id })}
          />
        ) : (
          <div className="card text-sm text-[var(--text-muted)]">Select a voice to inspect it.</div>
        )}
      </div>
    </div>
  );
}
