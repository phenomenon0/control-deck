"use client";

import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const INITIAL: BrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: true,
};

export function BrowserHeader(): React.ReactElement {
  const [state, setState] = useState<BrowserState>(INITIAL);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const surface = typeof window !== "undefined" ? window.deck?.browser : undefined;
    if (!surface) return;
    const unsubscribe = surface.onState((s) => {
      setState(s);
      if (!focused) setInput(s.url);
    });
    return unsubscribe;
  }, [focused]);

  const surface = typeof window !== "undefined" ? window.deck?.browser : undefined;

  const commit = useCallback(
    (raw: string) => {
      if (!surface) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      // Block self-XSS via the URL bar. loadURL("javascript:...") would execute
      // in the current page's context.
      if (/^\s*(javascript|data|vbscript):/i.test(trimmed)) return;
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
      const protocolRelative = trimmed.startsWith("//");
      const looksLikeQuery = trimmed.includes(" ") || !trimmed.includes(".");
      const url = hasScheme
        ? trimmed
        : protocolRelative
          ? `https:${trimmed}`
          : looksLikeQuery
            ? `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
            : `https://${trimmed}`;
      void surface.navigate(url);
      inputRef.current?.blur();
    },
    [surface],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(input);
    } else if (e.key === "Escape") {
      setInput(state.url);
      inputRef.current?.blur();
    }
  };

  const btn =
    "h-8 w-8 inline-flex items-center justify-center rounded-md text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[color:var(--text-secondary)] transition-colors";

  return (
    <header
      className="flex h-10 w-full items-center gap-1 border-b px-2 select-none"
      style={{
        background: "var(--bg-primary)",
        borderColor: "var(--border)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          type="button"
          className={btn}
          disabled={!state.canGoBack}
          onClick={() => surface?.back()}
          aria-label="Back"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className={btn}
          disabled={!state.canGoForward}
          onClick={() => surface?.forward()}
          aria-label="Forward"
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => (state.loading ? surface?.stop() : surface?.reload())}
          aria-label={state.loading ? "Stop" : "Reload"}
        >
          {state.loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
        </button>
      </div>

      <div
        className="flex flex-1 items-center h-7 mx-1 rounded-md px-2.5"
        style={{
          background: "var(--bg-secondary)",
          border: `1px solid ${focused ? "var(--accent)" : "var(--border)"}`,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => {
            setFocused(false);
            setInput(state.url);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search or enter URL"
          spellCheck={false}
          autoCorrect="off"
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[color:var(--text-muted)]"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          type="button"
          className={btn}
          onClick={() => surface?.close()}
          aria-label="Close window"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
