/**
 * Single source of truth for the pane types available in the
 * workspace. Adding a new pane type means adding an entry here AND
 * registering its adapter component in WorkspaceShell's COMPONENTS map.
 */

export interface PaneCatalogEntry {
  /** Dockview component name — must match a key in COMPONENTS. */
  component: string;
  /** Label for the "+" menu. */
  label: string;
  /** Default title when a new instance is spawned. */
  defaultTitle: string;
}

export const PANE_CATALOG: readonly PaneCatalogEntry[] = [
  { component: "chat",      label: "Chat",      defaultTitle: "Chat" },
  { component: "terminal",  label: "Terminal",  defaultTitle: "Terminal" },
  { component: "canvas",    label: "Canvas",    defaultTitle: "Canvas" },
  { component: "browser",   label: "Browser",   defaultTitle: "Browser" },
  { component: "notes",     label: "Notes",     defaultTitle: "Notes" },
];
