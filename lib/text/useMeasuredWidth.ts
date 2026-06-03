"use client";

/**
 * useMeasuredWidth — track an element's content-box inline size via
 * ResizeObserver. Returns a ref callback + the current width (0 until measured).
 *
 * Used to feed Pretext the width it should lay text out against, so we react to
 * container resizes (panel collapse, window resize) without polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export function useMeasuredWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    roRef.current?.disconnect();
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const inline = e?.contentBoxSize?.[0]?.inlineSize ?? e?.contentRect.width;
      if (inline != null) setWidth(inline);
    });
    ro.observe(node);
    roRef.current = ro;
    setWidth(node.clientWidth);
  }, []);

  useEffect(() => () => roRef.current?.disconnect(), []);

  return [ref, width];
}
