"use client";

import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useWarp, type Accent, type Theme, type TypeSet, type Warmth } from "@/components/warp/WarpProvider";
import { Panel, Row, Segment, SectionHeader, Toggle } from "../shared/FormBits";

/**
 * UI & Appearance section. Delegates to the existing `useWarp` and
 * `useDeckSettings` providers so the pane and the drawer stay in lockstep.
 */
export function UiSection() {
  const { tweaks, setTweak, reset: resetTweaks } = useWarp();
  const { prefs, updatePrefs } = useDeckSettings();

  return (
    <>
      <SectionHeader
        title="UI & Appearance"
        description="Theme, typography, accent color, and motion preferences. Changes apply immediately and persist locally."
      />

      <Panel title="Theme">
        <Row label="Mode">
          <Segment<Theme>
            value={tweaks.theme}
            onChange={(v) => setTweak("theme", v)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </Row>
        <Row label="Warmth" hint="Shifts the neutral palette toward cool/warm/ember.">
          <Segment<Warmth>
            value={tweaks.warmth}
            onChange={(v) => setTweak("warmth", v)}
            options={[
              { value: "cool", label: "Cool" },
              { value: "neutral", label: "Neutral" },
              { value: "warm", label: "Warm" },
              { value: "ember", label: "Ember" },
            ]}
          />
        </Row>
        <Row label="Accent">
          <Segment<Accent>
            value={tweaks.accent}
            onChange={(v) => setTweak("accent", v)}
            options={[
              { value: "mono", label: "Mono" },
              { value: "amber", label: "Amber" },
              { value: "ember", label: "Ember" },
              { value: "sage", label: "Sage" },
            ]}
          />
        </Row>
      </Panel>

      <Panel title="Typography">
        <Row label="Family">
          <Segment<TypeSet>
            value={tweaks.type}
            onChange={(v) => setTweak("type", v)}
            options={[
              { value: "matter", label: "Matter" },
              { value: "inter", label: "Inter" },
              { value: "editorial", label: "Editorial" },
            ]}
          />
        </Row>
      </Panel>

      <Panel title="Motion">
        <Row
          label="Reduce motion"
          hint="Disables transitions and animations. Respects system preference."
        >
          <Toggle
            checked={prefs.reduceMotion}
            onChange={(v) => updatePrefs({ reduceMotion: v })}
          />
        </Row>
      </Panel>

      <Panel title="Chat surface">
        <Row label="Surface" hint="How the chat pane presents agent output.">
          <Segment
            value={prefs.chatSurface}
            onChange={(v) => updatePrefs({ chatSurface: v as typeof prefs.chatSurface })}
            options={[
              { value: "safe", label: "Safe" },
              { value: "brave", label: "Brave" },
              { value: "radical", label: "Radical" },
            ]}
          />
        </Row>
        <Row label="Context rail">
          <Toggle
            checked={prefs.chatContextRail}
            onChange={(v) => updatePrefs({ chatContextRail: v })}
          />
        </Row>
      </Panel>

      <button
        type="button"
        className="settings-reset"
        onClick={resetTweaks}
      >
        Reset appearance to defaults
      </button>
    </>
  );
}
