"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface InlineBrowserPaneProps {
  /** Initial URL. */
  initialUrl?: string;
  /** Called when navigation completes — used by the adapter to publish topics. */
  onNavigate?: (url: string, title: string) => void;
  /** Called on mount with imperative navigate/read handlers. */
  onReady?: (api: InlineBrowserApi) => void;
}

export interface InlineBrowserApi {
  navigate: (url: string) => void;
  getUrl: () => string;
  getTitle: () => string;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
}

/**
 * Inline browser pane — renders an Electron <webview> when available,
 * falls back to an <iframe> in pure-web context. URL bar at the top,
 * page content below. Suitable for the "two browsers side by side"
 * workflow the workspace is designed around.
 *
 * The webview tag needs `webPreferences.webviewTag: true` in the
 * BrowserWindow config. Control Deck's electron/main.ts typically
 * enables this for the themed-browser service; if you're on a build
 * where it's disabled, the fallback iframe still works for
 * CSP-permissive URLs (example.com, jsonplaceholder, etc.).
 */
export function InlineBrowserPane(props: InlineBrowserPaneProps) {
  const [url, setUrl] = useState(props.initialUrl ?? "https://example.com");
  const [displayUrl, setDisplayUrl] = useState(url);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  const webviewRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement | null>(null);

  const isElectron = typeof window !== "undefined" && typeof window.process === "object";

  const navigate = useCallback((next: string) => {
    let finalUrl = next.trim();
    if (!finalUrl) return;
    if (!/^[a-z]+:\/\//i.test(finalUrl)) finalUrl = "https://" + finalUrl;
    setUrl(finalUrl);
    setDisplayUrl(finalUrl);
  }, []);

  // Publish the InlineBrowserApi once on mount.
  useEffect(() => {
    props.onReady?.({
      navigate,
      getUrl: () => url,
      getTitle: () => title,
      goBack: () => {
        const view = viewRef.current as unknown as { goBack?: () => void } | null;
        view?.goBack?.();
      },
      goForward: () => {
        const view = viewRef.current as unknown as { goForward?: () => void } | null;
        view?.goForward?.();
      },
      reload: () => {
        const view = viewRef.current as unknown as { reload?: () => void } | null;
        if (view?.reload) view.reload();
        else setUrl((u) => u + (u.includes("?") ? "&" : "?") + "_ts=" + Date.now());
      },
    });
  }, [navigate, props, title, url]);

  // Wire up webview event listeners for URL/title updates.
  useEffect(() => {
    if (!isElectron) return;
    const host = webviewRef.current;
    if (!host) return;

    // Create the webview imperatively — React doesn't know about the
    // <webview> custom element's typed attribute surface.
    const view = document.createElement("webview") as HTMLElement & {
      src: string;
      setAttribute(name: string, value: string): void;
    };
    view.src = url;
    view.setAttribute("style", "width:100%;height:100%;border:0;");
    view.setAttribute("allowpopups", "true");

    const onDidNavigate = (e: Event) => {
      const target = e.target as unknown as { getURL?: () => string };
      const newUrl = target.getURL?.() ?? "";
      setDisplayUrl(newUrl);
      setLoading(false);
    };
    const onStartLoading = () => setLoading(true);
    const onStopLoading = () => setLoading(false);
    const onPageTitle = (e: Event) => {
      const evt = e as unknown as { title?: string };
      if (evt.title) {
        setTitle(evt.title);
        const target = view as unknown as { getURL?: () => string };
        props.onNavigate?.(target.getURL?.() ?? "", evt.title);
      }
    };

    view.addEventListener("did-navigate", onDidNavigate);
    view.addEventListener("did-navigate-in-page", onDidNavigate);
    view.addEventListener("did-start-loading", onStartLoading);
    view.addEventListener("did-stop-loading", onStopLoading);
    view.addEventListener("page-title-updated", onPageTitle);

    host.appendChild(view);
    viewRef.current = view;

    return () => {
      view.removeEventListener("did-navigate", onDidNavigate);
      view.removeEventListener("did-navigate-in-page", onDidNavigate);
      view.removeEventListener("did-start-loading", onStartLoading);
      view.removeEventListener("did-stop-loading", onStopLoading);
      view.removeEventListener("page-title-updated", onPageTitle);
      host.removeChild(view);
      viewRef.current = null;
    };
    // Only re-create the webview when the host mounts, not on every
    // url change — subsequent navigations update its `src` via the
    // effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron]);

  // Apply url changes to an existing webview.
  useEffect(() => {
    const view = viewRef.current as unknown as { src?: string } | null;
    if (view && view.src !== url) view.src = url;
  }, [url]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("url") as HTMLInputElement | null;
    if (input) navigate(input.value);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#111" }}>
      <form
        onSubmit={onSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 6,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.3)",
        }}
      >
        <button
          type="button"
          onClick={() => (viewRef.current as unknown as { goBack?: () => void })?.goBack?.()}
          style={navBtn}
          title="Back"
        >←</button>
        <button
          type="button"
          onClick={() => (viewRef.current as unknown as { goForward?: () => void })?.goForward?.()}
          style={navBtn}
          title="Forward"
        >→</button>
        <button
          type="button"
          onClick={() => {
            const view = viewRef.current as unknown as { reload?: () => void } | null;
            if (view?.reload) view.reload();
            else setUrl((u) => u + (u.includes("?") ? "&" : "?") + "_ts=" + Date.now());
          }}
          style={navBtn}
          title="Reload"
        >⟳</button>
        <input
          name="url"
          defaultValue={displayUrl}
          key={displayUrl}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            padding: "4px 10px",
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 3,
            color: "#ddd",
            outline: "none",
          }}
        />
        {loading && <span style={{ fontSize: 11, opacity: 0.5 }}>loading…</span>}
      </form>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {isElectron ? (
          <div ref={webviewRef} style={{ width: "100%", height: "100%" }} />
        ) : (
          <iframe
            src={url}
            title={title || url}
            style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
          />
        )}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  color: "#ddd",
  cursor: "pointer",
  minWidth: 26,
};
