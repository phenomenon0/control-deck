"use client";

/**
 * FoldPanel — a one-line collapsible wrapper around the shared `au-panel`
 * style. Used to hide reference content (cheat-sheets, decision logs,
 * keyboard maps) so the surface stays uncluttered.
 *
 * Open/closed state persists per `storageKey` so a user's chosen layout
 * survives page reloads.
 */

import { useEffect, useState } from "react";

export interface FoldPanelProps {
  /** localStorage key for persisting open state. */
  storageKey?: string;
  defaultOpen?: boolean;
  label: React.ReactNode;
  counter?: React.ReactNode;
  /** Extra modifier classes on the outer .au-panel. */
  className?: string;
  children: React.ReactNode;
}

export function FoldPanel({
  storageKey,
  defaultOpen = true,
  label,
  counter,
  className,
  children,
}: FoldPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return;
      setOpen(raw === "1");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          /* quota; ignore */
        }
      }
      return next;
    });
  };

  return (
    <div
      className={`au-panel au-panel--fold${open ? " is-open" : " is-closed"}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="au-panel__head"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="au-panel__label">
          {label}
          {counter != null ? <span className="au-panel__counter">{counter}</span> : null}
        </span>
        <span className="au-panel__chev" aria-hidden>
          ▾
        </span>
      </button>
      {open ? <div className="au-panel__body">{children}</div> : null}
    </div>
  );
}
