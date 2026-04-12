"use client";

/**
 * RichText — lightweight markdown renderer for agent message content
 *
 * Handles the subset of markdown that LLMs actually produce:
 *   - Code blocks (``` with language tag) → styled blocks with copy/canvas
 *   - Inline code (`code`) → monospace spans
 *   - Bold (**text**) → <strong>
 *   - Italic (*text*) → <em>
 *   - Links [text](url) → <a>
 *   - Headings (# ## ###) → styled headers
 *   - Unordered lists (- item) → <ul>
 *   - Ordered lists (1. item) → <ol>
 *   - Blockquotes (> text) → styled quote blocks
 *
 * Also applies content stripping to remove machine metadata from tool
 * results that the LLM may echo inline (SURFACE.md §4.2).
 *
 * Design-token-driven: all colors/spacing from CSS custom properties.
 * No external dependencies (no react-markdown, marked, etc.).
 */

import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { stripForDisplay } from "@/lib/chat/stripPatterns";

// =============================================================================
// Code Block component — styled block with copy + canvas buttons
// =============================================================================

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { openCode } = useCanvas();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    openCode(code, language || "text", language ? `${language} code` : "Code snippet");
  };

  const isExecutable = [
    "python", "javascript", "typescript", "go", "bash", "sh",
    "lua", "c", "react", "html", "threejs",
  ].includes(language?.toLowerCase() || "");

  return (
    <div className="rt-code-block">
      <pre className="rt-code-pre">
        <code className="rt-code-text">{code}</code>
      </pre>

      {language && <span className="rt-code-lang">{language}</span>}

      <div className="rt-code-actions">
        <button onClick={handleCopy} className="rt-code-btn">
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={handleOpenCanvas}
          className={`rt-code-btn ${isExecutable ? "rt-code-btn--exec" : ""}`}
        >
          <Maximize2 width={10} height={10} />
          {isExecutable ? "Run" : "Canvas"}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Inline markdown parser — converts inline formatting to React elements
// =============================================================================

/**
 * Parse inline markdown tokens into React elements.
 * Handles: **bold**, *italic*, `code`, [links](url)
 *
 * Uses a single-pass tokenizer that finds the earliest match and recurses.
 */
function parseInline(text: string, keyPrefix: string = "i"): ReactNode[] {
  if (!text) return [];

  interface InlineMatch { index: number; length: number; node: ReactNode }

  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Collect all candidate matches, then pick the earliest
    const candidates: InlineMatch[] = [];

    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      candidates.push({
        index: boldMatch.index,
        length: boldMatch[0].length,
        node: (
          <strong key={`${keyPrefix}-b${key}`} className="rt-bold">
            {parseInline(boldMatch[1], `${keyPrefix}-b${key}`)}
          </strong>
        ),
      });
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index !== undefined) {
      candidates.push({
        index: codeMatch.index,
        length: codeMatch[0].length,
        node: (
          <code key={`${keyPrefix}-c${key}`} className="rt-inline-code">
            {codeMatch[1]}
          </code>
        ),
      });
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      candidates.push({
        index: linkMatch.index,
        length: linkMatch[0].length,
        node: (
          <a
            key={`${keyPrefix}-l${key}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="rt-link"
          >
            {linkMatch[1]}
          </a>
        ),
      });
    }

    // Italic: *text* (single asterisk, not inside **)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    if (italicMatch && italicMatch.index !== undefined) {
      candidates.push({
        index: italicMatch.index,
        length: italicMatch[0].length,
        node: (
          <em key={`${keyPrefix}-e${key}`}>
            {parseInline(italicMatch[1], `${keyPrefix}-e${key}`)}
          </em>
        ),
      });
    }

    // Pick the earliest match
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.index - b.index);
      const winner = candidates[0];
      // Text before the match
      if (winner.index > 0) {
        nodes.push(remaining.slice(0, winner.index));
      }
      nodes.push(winner.node);
      remaining = remaining.slice(winner.index + winner.length);
      key++;
    } else {
      // No more patterns — rest is plain text
      nodes.push(remaining);
      break;
    }
  }

  return nodes;
}

// =============================================================================
// Block-level parser — splits content into paragraphs, headings, lists, quotes
// =============================================================================

interface Block {
  type: "paragraph" | "heading" | "ul" | "ol" | "blockquote" | "code";
  content: string;
  level?: number; // heading level (1-3)
  lang?: string;  // code language
  items?: string[]; // list items
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading: # ## ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        content: headingMatch[2],
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }

    // Unordered list: - item or * item
    if (/^[\s]*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }

    // Ordered list: 1. item
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }

    // Blockquote: > text
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[\s]*[-*]\s+/.test(lines[i]) &&
      !/^[\s]*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: paraLines.join("\n") });
  }

  return blocks;
}

// =============================================================================
// Block renderers
// =============================================================================

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const levelClass = `rt-heading--${block.level || 1}`;
      return (
        <div key={`block-${index}`} className={`rt-heading ${levelClass}`}>
          {parseInline(block.content, `h${index}`)}
        </div>
      );
    }

    case "ul":
      return (
        <ul key={`block-${index}`} className="rt-list rt-list--ul">
          {block.items?.map((item, j) => (
            <li key={j} className="rt-list-item">
              {parseInline(item, `ul${index}-${j}`)}
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol key={`block-${index}`} className="rt-list rt-list--ol">
          {block.items?.map((item, j) => (
            <li key={j} className="rt-list-item">
              {parseInline(item, `ol${index}-${j}`)}
            </li>
          ))}
        </ol>
      );

    case "blockquote":
      return (
        <blockquote key={`block-${index}`} className="rt-blockquote">
          {parseInline(block.content, `bq${index}`)}
        </blockquote>
      );

    case "paragraph":
    default:
      return (
        <p key={`block-${index}`} className="rt-paragraph">
          {parseInline(block.content, `p${index}`)}
        </p>
      );
  }
}

// =============================================================================
// RichText — main component
// =============================================================================

interface RichTextProps {
  /** Raw content string (may contain markdown + machine metadata) */
  content: string;
  /** Whether to strip machine metadata patterns */
  strip?: boolean;
}

export function RichText({ content, strip = true }: RichTextProps) {
  const cleaned = strip ? stripForDisplay(content) : content;
  if (!cleaned) return null;

  // Split by code blocks first: ```lang\ncode```
  const parts: { type: "text" | "code"; content: string; lang?: string }[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: cleaned.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[2], lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    parts.push({ type: "text", content: cleaned.slice(lastIndex) });
  }

  // If no structure found at all, wrap as a single text part
  if (parts.length === 0) {
    parts.push({ type: "text", content: cleaned });
  }

  return (
    <div>
      {parts.map((part, idx) => {
        if (part.type === "code") {
          return <CodeBlock key={`code-${idx}`} code={part.content} language={part.lang} />;
        }

        // Parse text part into blocks (headings, lists, paragraphs, etc.)
        const blocks = parseBlocks(part.content);
        return (
          <div key={`text-${idx}`}>
            {blocks.map((block, blockIdx) => renderBlock(block, blockIdx))}
          </div>
        );
      })}
    </div>
  );
}
