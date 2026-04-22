"use client";

import { SectionHeader, Panel, StubCard } from "../shared/FormBits";

/**
 * Input & Shortcuts — stub that points to the real keybindings source. The
 * shortcut registry is wired through `lib/hooks/useShortcuts`; an interactive
 * editor is follow-up work.
 */
export function InputSection() {
  return (
    <>
      <SectionHeader
        title="Input & Shortcuts"
        description="Keyboard shortcuts registered by the current session."
      />

      <Panel title="Shortcut catalogue">
        <StubCard
          title="Interactive rebinding — coming soon"
          description="The shortcut registry is tracked per-hook today. A rebinding UI surfaces here in the next pass; for now, refer to the palette (⌘K) for the live list and hold-to-discover labels."
        />
      </Panel>
    </>
  );
}
