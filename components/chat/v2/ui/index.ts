/**
 * v2 coherence primitives — the shared presentational vocabulary for the whole
 * deck (chat / comfy / settings). Token-driven, dependency-free, `cd-*`-hooked.
 *
 * Import from here, not the individual files:
 *   import { Button, EmptyState, Panel, PanelHeader, Badge } from "@/components/chat/v2/ui";
 */
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";
export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone, BadgeVariant } from "./Badge";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps, EmptyStateVariant } from "./EmptyState";
export { Panel } from "./Panel";
export type { PanelProps, PanelBorder, PanelScrollProps } from "./Panel";
export { PanelHeader, SectionHeading } from "./PanelHeader";
export type { PanelHeaderProps, SectionHeadingProps } from "./PanelHeader";
export { cx } from "./cx";
