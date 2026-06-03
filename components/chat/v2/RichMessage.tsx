"use client";

/**
 * RichMessage (v2) — renders an assistant message body, routing fenced blocks to
 * the rich renderers (code → CodeBlock, ```mermaid → MermaidBlock, ```vega-lite /
 * ```vega → ChartBlock, ```math/```latex → MathBlock, ```html → HtmlPreview) and
 * the prose in between via RichText. This is what wires Phase B into the message
 * flow — so an agent reply with a chart spec or code actually renders rich.
 */

import { Fragment, useMemo } from "react";
import { RichText } from "./RichText";
import { CodeBlock } from "./CodeBlock";
import { ChartBlock } from "./ChartBlock";
import { MermaidBlock } from "./MermaidBlock";
import { MathBlock } from "./MathBlock";
import { HtmlPreview } from "./HtmlPreview";
import { classifyFence } from "./richContent";

export interface RichMessageProps {
  content: string;
  onRun?: (code: string, language?: string) => void;
  onOpenCanvas?: (code: string, language?: string) => void;
}

interface Part {
  prose?: string;
  fence?: { lang?: string; code: string };
}

const FENCE = /```([\w-]*)\n([\s\S]*?)```/g;

function splitFences(src: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) {
    if (m.index > last) parts.push({ prose: src.slice(last, m.index) });
    parts.push({ fence: { lang: m[1] || undefined, code: m[2].replace(/\n$/, "") } });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ prose: src.slice(last) });
  return parts;
}

export function RichMessage({ content, onRun, onOpenCanvas }: RichMessageProps) {
  const parts = useMemo(() => splitFences(content), [content]);
  return (
    <div className="cd-richmsg flex flex-col gap-2">
      {parts.map((p, i) => {
        if (p.prose != null) {
          return p.prose.trim() ? <RichText key={i} content={p.prose} /> : <Fragment key={i} />;
        }
        const { lang, code } = p.fence!;
        const c = classifyFence(lang, code);
        if (c.kind === "chart") return <ChartBlock key={i} spec={c.data as Record<string, unknown>} />;
        if (c.kind === "mermaid") return <MermaidBlock key={i} code={code} />;
        if (c.kind === "math") return <MathBlock key={i} tex={code} block />;
        if (c.kind === "html") return <HtmlPreview key={i} html={code} onOpenCanvas={(h) => onOpenCanvas?.(h, "html")} />;
        return <CodeBlock key={i} code={code} language={lang} onRun={onRun} onOpenCanvas={onOpenCanvas} />;
      })}
    </div>
  );
}

export default RichMessage;
