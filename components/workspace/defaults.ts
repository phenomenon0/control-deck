/**
 * Default workspace layouts shipped with the deck. These are the
 * "beginning" — users fork + save their own from here.
 *
 * The shape is Dockview's native GroupPanelViewState JSON. Keeping it
 * opaque (vs. our own IR) means Dockview's serialize/deserialize
 * round-trip is authoritative.
 */

export const DEFAULT_WORKSPACE_LAYOUT = {
  grid: {
    root: {
      type: "branch" as const,
      data: [
        {
          type: "leaf" as const,
          data: {
            views: ["chat"],
            activeView: "chat",
            id: "1",
          },
          size: 700,
        },
        {
          type: "leaf" as const,
          data: {
            views: ["terminal"],
            activeView: "terminal",
            id: "2",
          },
          size: 500,
        },
      ],
      size: 800,
    },
    width: 1200,
    height: 800,
    orientation: "HORIZONTAL" as const,
  },
  panels: {
    chat: {
      id: "chat",
      contentComponent: "chat",
      title: "Chat",
      params: { paneType: "chat", instanceId: "chat-default" },
    },
    terminal: {
      id: "terminal",
      contentComponent: "terminal",
      title: "Terminal",
      params: { paneType: "terminal", instanceId: "terminal-default" },
    },
  },
};

/** LocalStorage key for the user's last-used workspace layout. */
export const WORKSPACE_LAYOUT_KEY = "deck:workspace:layout:v1";
