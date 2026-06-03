/**
 * paneIcons — the CANONICAL pane icon set for the deck rail.
 *
 * Each theme is its own universe, so the rail's pane icons are chosen per family
 * (humanist → text/chevron/layers, technical → square/grid, playful →
 * circle/wand/boxes) by the theme-by-theme critique pass. This module is the
 * single source of truth (lifted out of the story) so the rail, the full deck
 * view, and anywhere else all draw from the same canon. Stroke weight / caps /
 * idle contrast come from the per-theme --icon-* tokens in .storybook/icons.css.
 */

import type { ComponentType } from "react";
import {
  Aperture, Brush, ChevronRight, Frame, Image as ImageIcon,
  MessageCircle, MessageSquare, MessageSquareText,
  Settings, Settings2, SlidersHorizontal, SquareChevronRight,
  SquareTerminal, Terminal, WandSparkles,
} from "lucide-react";

/** Any icon component taking `size` (lucide-react). Stroke comes from CSS tokens. */
export type PaneIcon = ComponentType<{ size?: number }>;

export type PaneId = "chat" | "terminal" | "comfy" | "settings";
export type PaneIcons = Record<PaneId, PaneIcon>;

/** Rail destinations (order matters); settings is rendered in the footer. */
export const PANE_LABELS: ReadonlyArray<[PaneId, string]> = [
  ["chat", "Chat"],
  ["terminal", "Terminal"],
  ["comfy", "Comfy"],
];

/** Fallback for deck themes (dark/light/hacker) and any unmapped theme. */
export const DEFAULT_PANE_ICONS: PaneIcons = {
  chat: MessageSquare,
  terminal: Terminal,
  comfy: ImageIcon,
  settings: Settings,
};

/** Per-theme canon — each family's icons suit its character. */
export const PANE_ICONS: Record<string, PaneIcons> = {
  claude: { chat: MessageSquareText, terminal: ChevronRight, comfy: Aperture, settings: SlidersHorizontal },
  vercel: { chat: MessageSquare, terminal: SquareTerminal, comfy: Frame, settings: Settings2 },
  linear: { chat: MessageSquare, terminal: SquareTerminal, comfy: Aperture, settings: Settings2 },
  spotify: { chat: MessageCircle, terminal: SquareTerminal, comfy: WandSparkles, settings: Settings },
  elevenlabs: { chat: MessageSquare, terminal: Terminal, comfy: Aperture, settings: SlidersHorizontal },
  stripe: { chat: MessageSquare, terminal: SquareTerminal, comfy: Aperture, settings: Settings2 },
  notion: { chat: MessageSquareText, terminal: ChevronRight, comfy: ImageIcon, settings: Settings2 },
  ferrari: { chat: MessageSquare, terminal: SquareTerminal, comfy: Aperture, settings: Settings2 },
  playstation: { chat: MessageCircle, terminal: SquareChevronRight, comfy: Aperture, settings: Settings },
  "velvet-light": { chat: MessageSquareText, terminal: ChevronRight, comfy: Aperture, settings: SlidersHorizontal },
  "velvet-dark": { chat: MessageSquareText, terminal: ChevronRight, comfy: Aperture, settings: SlidersHorizontal },
  "velvet-deep": { chat: MessageSquareText, terminal: Terminal, comfy: Frame, settings: Settings },
  homey: { chat: MessageCircle, terminal: ChevronRight, comfy: Brush, settings: Settings2 },
  academia: { chat: MessageSquareText, terminal: ChevronRight, comfy: Frame, settings: SlidersHorizontal },
  industrial: { chat: MessageSquare, terminal: SquareTerminal, comfy: Aperture, settings: SlidersHorizontal },
};

/** Canon lookup: the family's icon set, or the deck default. */
export function getPaneIcons(theme: string): PaneIcons {
  return PANE_ICONS[theme] ?? DEFAULT_PANE_ICONS;
}
