"use client";

/**
 * Atlas markdown — the chat-v2 assistant prose renderer.
 *
 * The bare hand-rolled renderer that used to live here (bold/italic/code/lists/
 * headings only) has been replaced by the richer `RichText` renderer in
 * ./richtext.tsx (marked + KaTeX math + GFM tables + safe HTML + fenced code
 * with graceful diagram degradation). This module stays as the stable import
 * path — `import { Markdown } from "@/lib/chat-v2/markdown"` — so the chat call
 * sites are unchanged.
 */

export { Markdown, RichText, default } from "./richtext";
export type { RichTextProps } from "./richtext";
