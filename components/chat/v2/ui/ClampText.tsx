"use client";

/**
 * ClampText (v2 primitive) — clamp text to N lines AND know whether it was
 * actually truncated.
 *
 * CSS already does the visual clamp (ellipsis / -webkit-line-clamp). What CSS
 * *can't* tell you is whether the clamp bit — the usual `scrollWidth >
 * clientWidth` trick forces a layout read and silently breaks for multi-line
 * clamps. Pretext answers "does this string overflow N lines at this width?"
 * from pure measurement (Canvas2D + Intl.Segmenter), no reflow — so we only
 * attach a tooltip / fire `onTruncatedChange` when there's really hidden text.
 *
 * It reads its OWN computed font, so it measures exactly what the active theme
 * renders (family / weight / size / letter-spacing) with no per-theme wiring.
 */

import { createElement, useEffect, useRef, useState, type CSSProperties, type ElementType } from "react";

import { canMeasureText, isTruncated, onFontsReady } from "@/lib/text/measure";
import { useMeasuredWidth } from "@/lib/text/useMeasuredWidth";

import { cx } from "./cx";

export interface ClampTextProps {
  /** The text to render and measure. */
  children: string;
  /** Visual clamp height in lines (default 1 = single-line ellipsis). */
  lines?: number;
  /** Element to render (default "span"). */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** Set the native `title` tooltip to the full text when truncated (default true). */
  titleWhenTruncated?: boolean;
  /** Called whenever truncation state flips — for custom affordances (expand, fade). */
  onTruncatedChange?: (truncated: boolean) => void;
}

function readCanvasFont(el: HTMLElement): { font: string; letterSpacing: number } {
  const cs = getComputedStyle(el);
  const style = cs.fontStyle && cs.fontStyle !== "normal" ? `${cs.fontStyle} ` : "";
  const weight = cs.fontWeight && cs.fontWeight !== "400" && cs.fontWeight !== "normal" ? `${cs.fontWeight} ` : "";
  // Canvas font shorthand: [style] [weight] <size> <family> — NO line-height.
  const font = `${style}${weight}${cs.fontSize} ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing);
  return { font, letterSpacing: Number.isFinite(ls) ? ls : 0 };
}

const clampStyle = (lines: number): CSSProperties =>
  lines <= 1
    ? // `display:block` so the element fills its column (a bare inline span would
      // shrink to its content — no ellipsis, and the measured width would be the
      // full text, defeating truncation detection).
      { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
    : {
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      };

export function ClampText({
  children,
  lines = 1,
  as = "span",
  className,
  style,
  titleWhenTruncated = true,
  onTruncatedChange,
}: ClampTextProps) {
  const [observeWidth, width] = useMeasuredWidth<HTMLElement>();
  const nodeRef = useRef<HTMLElement | null>(null);
  const changeRef = useRef(onTruncatedChange);
  changeRef.current = onTruncatedChange;
  const [truncated, setTruncated] = useState(false);

  const setRef = (n: HTMLElement | null) => {
    nodeRef.current = n;
    observeWidth(n);
  };

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !canMeasureText || width <= 0) return;
    const evaluate = () => {
      const { font, letterSpacing } = readCanvasFont(el);
      const t = isTruncated(children, font, width, lines, { letterSpacing });
      setTruncated((prev) => {
        if (prev !== t) changeRef.current?.(t);
        return t;
      });
    };
    evaluate();
    return onFontsReady(evaluate); // re-measure once webfonts settle
  }, [children, width, lines]);

  return createElement(
    as,
    {
      ref: setRef,
      className: cx("cd-clamp", className),
      title: titleWhenTruncated && truncated ? children : undefined,
      style: { ...clampStyle(lines), ...style },
    },
    children,
  );
}

export default ClampText;
