"use client";

/**
 * Atlas markdown — minimal renderer for chat-v2 assistant prose.
 *
 * Emits BARE elements (p / strong / em / code / a / ul / ol / li / blockquote /
 * pre) so the paper-klein `.av2` element selectors in atlas-v2.css style them
 * directly. The deck's shared `RichText` can't be reused here: it hard-depends
 * on `CanvasProvider` (throws without it) and its `rt-*` classes are keyed to
 * the dark-theme tokens, which conflict with the Atlas paper surface. The
 * parsing shape mirrors RichText (headings, lists, quotes, tables, inline
 * bold/italic/code/links, fenced code) minus that coupling.
 */

import { type ReactNode } from "react";
import { safeMarkdownHref } from "@/lib/chat/safeMarkdownHref";

/** Inline tokenizer: earliest-match of **bold** / *italic* / `code` / [link](url). */
function parseInline(text: string, keyPrefix = "i"): ReactNode[] {
  if (!text) return [];
  interface Match { index: number; length: number; node: ReactNode }
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const candidates: Match[] = [];

    const bold = remaining.match(/\*\*(.+?)\*\*/);
    if (bold && bold.index !== undefined)
      candidates.push({
        index: bold.index,
        length: bold[0].length,
        node: <strong key={`${keyPrefix}-b${key}`}>{parseInline(bold[1], `${keyPrefix}-b${key}`)}</strong>,
      });

    const code = remaining.match(/`([^`]+)`/);
    if (code && code.index !== undefined)
      candidates.push({
        index: code.index,
        length: code[0].length,
        node: <code key={`${keyPrefix}-c${key}`}>{code[1]}</code>,
      });

    const link = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (link && link.index !== undefined) {
      const href = safeMarkdownHref(link[2]);
      candidates.push({
        index: link.index,
        length: link[0].length,
        node: href ? (
          <a key={`${keyPrefix}-l${key}`} href={href} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        ) : (
          <span key={`${keyPrefix}-l${key}`}>{link[1]}</span>
        ),
      });
    }

    const italic = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    if (italic && italic.index !== undefined)
      candidates.push({
        index: italic.index,
        length: italic[0].length,
        node: <em key={`${keyPrefix}-e${key}`}>{parseInline(italic[1], `${keyPrefix}-e${key}`)}</em>,
      });

    if (candidates.length === 0) {
      nodes.push(remaining);
      break;
    }
    candidates.sort((a, b) => a.index - b.index);
    const win = candidates[0];
    if (win.index > 0) nodes.push(remaining.slice(0, win.index));
    nodes.push(win.node);
    remaining = remaining.slice(win.index + win.length);
    key++;
  }
  return nodes;
}

interface Block {
  type: "paragraph" | "heading" | "ul" | "ol" | "blockquote";
  content: string;
  level?: number;
  items?: string[];
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push({ type: "heading", content: heading[2], level: heading[1].length }); i++; continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "blockquote", content: q.join("\n") });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) && !/^>\s?/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    blocks.push({ type: "paragraph", content: para.join("\n") });
  }
  return blocks;
}

function renderBlock(block: Block, idx: number): ReactNode {
  switch (block.type) {
    case "heading":
      return <p key={idx} className="md-h"><strong>{parseInline(block.content, `h${idx}`)}</strong></p>;
    case "ul":
      return <ul key={idx}>{block.items?.map((it, j) => <li key={j}>{parseInline(it, `ul${idx}-${j}`)}</li>)}</ul>;
    case "ol":
      return <ol key={idx}>{block.items?.map((it, j) => <li key={j}>{parseInline(it, `ol${idx}-${j}`)}</li>)}</ol>;
    case "blockquote":
      return <blockquote key={idx}>{parseInline(block.content, `bq${idx}`)}</blockquote>;
    default:
      return <p key={idx}>{parseInline(block.content, `p${idx}`)}</p>;
  }
}

/** Render markdown as Atlas-native prose. Non-executable fenced blocks stay
 *  inline as <pre><code>; executable blocks are lifted to canvas objects by
 *  the caller (parseAssistant) before this ever sees them. */
export function Markdown({ content }: { content: string }) {
  if (!content) return null;

  const parts: { type: "text" | "code"; content: string; lang?: string }[] = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: "text", content: content.slice(last, m.index) });
    parts.push({ type: "code", content: m[2].replace(/\n$/, ""), lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", content: content.slice(last) });
  if (parts.length === 0) parts.push({ type: "text", content });

  return (
    <>
      {parts.map((part, idx) =>
        part.type === "code" ? (
          <pre key={idx} data-lang={part.lang || undefined}><code>{part.content}</code></pre>
        ) : (
          <div key={idx}>{parseBlocks(part.content).map((b, j) => renderBlock(b, j))}</div>
        )
      )}
    </>
  );
}
