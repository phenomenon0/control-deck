"use client";

/**
 * App-level context for the SourcePreview drawer. Any card in the
 * inference pane can call `useSourcePreview().open(url, label)` to slide
 * in the preview. Centralises state so there's only one drawer ever open
 * at a time and no prop-drilling across the component tree.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

interface OpenPreviewArgs {
  url: string;
  /** Short label used in the drawer header before the fetched title lands. */
  label?: string;
}

interface SourcePreviewContextValue {
  current: OpenPreviewArgs | null;
  open: (args: OpenPreviewArgs) => void;
  close: () => void;
}

const SourcePreviewContext = createContext<SourcePreviewContextValue | null>(null);

export function SourcePreviewProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<OpenPreviewArgs | null>(null);
  const open = useCallback((args: OpenPreviewArgs) => setCurrent(args), []);
  const close = useCallback(() => setCurrent(null), []);
  const value = useMemo(() => ({ current, open, close }), [current, open, close]);
  return (
    <SourcePreviewContext.Provider value={value}>
      {children}
    </SourcePreviewContext.Provider>
  );
}

/** Hook — returns a no-op when called outside the provider. */
export function useSourcePreview(): SourcePreviewContextValue {
  const ctx = useContext(SourcePreviewContext);
  if (ctx) return ctx;
  return {
    current: null,
    open: () => {},
    close: () => {},
  };
}
