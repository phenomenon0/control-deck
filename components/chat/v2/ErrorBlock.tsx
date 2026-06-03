"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "./ui";

export interface ErrorBlockProps {
  error: string;
  retryable?: boolean;
  onRetry?: () => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function ErrorBlock({ error, retryable = false, onRetry }: ErrorBlockProps) {
  return (
    <div
      className="cd-error flex items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1.5"
      style={{ borderColor: "color-mix(in oklab, var(--err, #f87171), transparent 60%)", background: "color-mix(in oklab, var(--err, #f87171), transparent 90%)" }}
      role="alert"
    >
      <TriangleAlert size={14} style={{ color: "var(--err, #f87171)" }} />
      <span className="min-w-0 flex-1 text-[var(--text-primary)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
        {error}
      </span>
      {retryable && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0" style={{ ...MONO }}>
          retry
        </Button>
      )}
    </div>
  );
}

export default ErrorBlock;
