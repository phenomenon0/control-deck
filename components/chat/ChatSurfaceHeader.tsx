"use client";

/**
 * ChatSurfaceHeader — thread title + routing meta for the chat surface.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Pure presentational: three visual variants keyed off the deck's
 * `chatSurface` pref (safe / brave / radical).
 */

import type { ChatSurface as ChatSurfaceVariant } from "@/components/settings/DeckSettingsProvider";

function formatModelLabel(model: string): string {
  // No pinned model → routing resolves one per-request. "auto" reads as
  // intentional; the old "model pending" looked broken on a healthy deck.
  if (!model) return "auto";
  const parts = model.split(/[/\\]/);
  return parts[parts.length - 1].replace(/\.gguf$/i, "");
}

interface ChatSurfaceHeaderProps {
  surface: ChatSurfaceVariant;
  chatTitle: string;
  model: string;
  toolCount: number;
  artifactCount: number;
  messageCount: number;
}

export function ChatSurfaceHeader({
  surface,
  chatTitle,
  model,
  toolCount,
  artifactCount,
  messageCount,
}: ChatSurfaceHeaderProps) {
  if (surface === "brave") {
    return (
      <header className="cs-thread-head cs-thread-head--brave">
        <div className="cs-dossier-title-block">
          <span className="cs-thread-kicker">Thread Brief</span>
          <h1 className="cs-thread-title">{chatTitle}</h1>
        </div>
        <div className="cs-thread-meta cs-thread-meta--brave" aria-label="Thread routing">
          <span className="cs-model-chip">{formatModelLabel(model)}</span>
          <span>routed local</span>
          <span>{messageCount} notes</span>
          <span>{toolCount} tools</span>
          <span>{artifactCount} files</span>
        </div>
      </header>
    );
  }

  if (surface === "radical") {
    return (
      <header className="cs-thread-head cs-thread-head--radical">
        <div className="cs-thread-title-block">
          <span className="cs-thread-kicker">Session Log</span>
          <h1 className="cs-thread-title">{chatTitle}</h1>
        </div>
        <div className="cs-thread-meta" aria-label="Thread routing">
          <span className="cs-model-chip">{formatModelLabel(model)}</span>
          <span>{toolCount} tools</span>
          <span>{artifactCount} files</span>
        </div>
      </header>
    );
  }

  return (
    <header className="cs-thread-head">
      <div className="cs-thread-title-block">
        <span className="cs-thread-kicker">Field Journal</span>
        <h1 className="cs-thread-title">{chatTitle}</h1>
      </div>
      <div className="cs-thread-meta" aria-label="Thread routing">
        <span className="cs-model-chip">{formatModelLabel(model)}</span>
        <span>local</span>
        <span>{toolCount} tools</span>
        <span>{artifactCount} files</span>
      </div>
    </header>
  );
}
