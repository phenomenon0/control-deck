"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus, Copy } from "lucide-react";
import { BrowserHeader } from "@/components/browser/BrowserHeader";
import { publishChatPrefill } from "@/lib/messages/chatPrefill";

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export function BrowserPane() {
  const [state, setState] = useState<BrowserState>({
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  });

  useEffect(() => {
    const surface = typeof window !== "undefined" ? window.deck?.browser : undefined;
    if (!surface) return;
    return surface.onState(setState);
  }, []);

  const hasPage = !!state.url;

  const sendLink = () => {
    if (!hasPage) return;
    publishChatPrefill({
      source: "browser",
      url: state.url,
      title: state.title,
      text: `Here's a page I'm looking at: ${state.title || state.url}\n${state.url}`,
    });
  };

  const copyLink = () => {
    if (!hasPage) return;
    void navigator.clipboard.writeText(state.url);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <BrowserHeader />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-auto p-6">
          {hasPage ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <div>
                <div className="text-xs text-[var(--text-muted)] mb-1">Current page</div>
                <div className="text-sm font-semibold text-[var(--text-primary)] break-words">
                  {state.title || "(untitled)"}
                </div>
                <div className="text-xs font-mono text-[var(--text-muted)] break-all mt-1">{state.url}</div>
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                The live page renders in the Electron browser window. This pane surfaces its state and lets
                you hand the current URL off to chat.
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
              Open the browser window to see page state here.
            </div>
          )}
        </div>
        <aside className="w-64 border-l border-[var(--border)] p-4 space-y-3 bg-[var(--bg-secondary)]">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Actions</div>
          <button
            type="button"
            onClick={sendLink}
            disabled={!hasPage}
            className="w-full btn btn-primary text-sm disabled:opacity-40"
          >
            <MessageSquarePlus className="w-3.5 h-3.5 mr-1.5 inline" />
            Send to chat
          </button>
          <button
            type="button"
            onClick={copyLink}
            disabled={!hasPage}
            className="w-full btn btn-secondary text-sm disabled:opacity-40"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5 inline" />
            Copy URL
          </button>
          <div className="pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            Status: {state.loading ? "loading…" : hasPage ? "idle" : "no page"}
          </div>
        </aside>
      </div>
    </div>
  );
}
