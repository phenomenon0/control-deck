"use client";

import { useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { publish, registerPane } from "@/lib/workspace";
import { InlineBrowserPane, type InlineBrowserApi } from "./InlineBrowserPane";

interface BrowserParams {
  instanceId?: string;
  initialUrl?: string;
}

/**
 * Dockview adapter for a real inline browser pane. Uses an Electron
 * <webview> tag when available, <iframe> in web context.
 *
 * Capabilities (all wired, not stubbed):
 *   - navigate(url)          — set the webview's src
 *   - read_url()             — current URL
 *   - read_title()           — current page title
 *   - go_back / go_forward / reload
 *
 * Topics:
 *   - navigated              — fires on did-navigate; rate ceiling 2/s.
 *   - title_changed          — fires on page-title-updated; rate ceiling 2/s.
 */
export function BrowserPanelAdapter(props: IDockviewPanelProps<BrowserParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const initialUrl = props.params?.initialUrl ?? "https://example.com";
  const paneId = `browser:${instanceId}`;

  const apiRef = useRef<InlineBrowserApi | null>(null);

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: "browser", label: props.api.title ?? "Browser" },
      capabilities: {
        navigate: {
          description: "Navigate to a URL",
          handler: (args: unknown) => {
            const { url } = args as { url: string };
            apiRef.current?.navigate(url);
            return { url };
          },
        },
        read_url: {
          description: "Current URL",
          handler: () => apiRef.current?.getUrl() ?? "",
        },
        read_title: {
          description: "Current page title",
          handler: () => apiRef.current?.getTitle() ?? "",
        },
        go_back: { description: "Back one page", handler: () => apiRef.current?.goBack() },
        go_forward: { description: "Forward one page", handler: () => apiRef.current?.goForward() },
        reload: { description: "Reload the current page", handler: () => apiRef.current?.reload() },
      },
      topics: {
        navigated: { expectedRatePerSec: 2, priority: "low", description: "URL changed" },
        title_changed: { expectedRatePerSec: 2, priority: "low", description: "Page title changed" },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  const onNavigate = (url: string, title: string) => {
    publish(paneId, "navigated", { url });
    if (title) publish(paneId, "title_changed", { title });
  };

  return (
    <InlineBrowserPane
      initialUrl={initialUrl}
      onReady={(api) => { apiRef.current = api; }}
      onNavigate={onNavigate}
    />
  );
}
