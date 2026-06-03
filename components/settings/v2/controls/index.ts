/**
 * Settings v2 control kit — barrel.
 *
 * The single import surface every ideology mockup composes from. Re-exports the
 * prop-driven, token-only primitives + structural containers + the declarative
 * settings registry. No provider imports anywhere in the kit.
 */

export type { Density, Traffic, Kind, SettingDef, SettingGroupName, Option } from "./types";

export {
  Toggle,
  Select,
  SegmentedControl,
  Slider,
  TextField,
  NumberField,
} from "./primitives";
export type {
  ToggleProps,
  SelectProps,
  SegmentedControlProps,
  SliderProps,
  TextFieldProps,
  NumberFieldProps,
} from "./primitives";

export { SettingRow } from "./SettingRow";
export type { SettingRowProps, SettingRowBadge } from "./SettingRow";

export { SettingGroup, SettingSection } from "./SettingGroup";
export type { SettingGroupProps, SettingSectionProps } from "./SettingGroup";

export { SettingsSearch, useSettingsFilter } from "./SettingsSearch";
export type { SettingsSearchProps } from "./SettingsSearch";

export { StatusTile } from "./StatusTile";
export type { StatusTileProps, TileStatus } from "./StatusTile";

export { ThemePicker } from "./ThemePicker";
export type { ThemePickerProps, ThemeState, ThemeName, WarmthName, AccentName } from "./ThemePicker";

export { SETTING_DEFS, HIGH, SET_ONCE } from "./registry";
