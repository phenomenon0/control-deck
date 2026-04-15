/**
 * Plugin System Types
 * 
 * Core type definitions for the plugin/widget system.
 * Plugins are configuration + templates, not arbitrary code.
 */

export type PluginTemplate = 
  | "ticker"   // Rotating single-line items (scores, headlines)
  | "feed"     // Scrollable list of items (news, alerts)
  | "cards"    // Visual cards with optional images/icons
  | "table"    // Structured data grid
  | "kv"       // Key-value pairs (stats, status)
  | "form";    // Input + submit + result

export interface ConfigFieldBase {
  type: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface StringConfigField extends ConfigFieldBase {
  type: "string";
  default?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;  // Regex pattern
  options?: string[];  // If provided, renders as select
}

export interface NumberConfigField extends ConfigFieldBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface BooleanConfigField extends ConfigFieldBase {
  type: "boolean";
  default?: boolean;
}

export interface ArrayConfigField extends ConfigFieldBase {
  type: "array";
  default?: string[];
  itemType?: "string" | "number";
  maxItems?: number;
}

export type ConfigField = 
  | StringConfigField 
  | NumberConfigField 
  | BooleanConfigField 
  | ArrayConfigField;

export type ConfigSchema = Record<string, ConfigField>;

export interface DataSource {
  /** Unique identifier for this source within the plugin */
  id: string;
  /** Tool to call (must be in allowlist) */
  tool: string;
  /** Arguments to pass to the tool - supports {{config.fieldName}} interpolation */
  args: Record<string, unknown>;
  /** Refresh interval: "1m", "5m", "15m", "30m", "1h", "6h", "24h", "manual" */
  refresh: string;
  /** Optional transform expression for the result */
  transform?: string;
}

export interface TickerRenderConfig {
  /** Source IDs to merge into the ticker */
  sources: string[];
  /** Enable cycling through items */
  cycle?: boolean;
  /** Cycle interval in ms (default: 5000) */
  cycleInterval?: number | string;  // Can be {{config.X}}
  /** Field to display as the main text */
  textField?: string;
  /** Optional link field */
  linkField?: string;
}

export interface FeedRenderConfig {
  /** Source ID to display */
  source: string;
  /** Max items to show */
  maxItems?: number;
  /** Item title field */
  titleField?: string;
  /** Item description/snippet field */
  descriptionField?: string;
  /** Item link field */
  linkField?: string;
  /** Item timestamp field */
  timeField?: string;
  /** Item icon/image field */
  imageField?: string;
}

export interface CardsRenderConfig {
  /** Source ID to display */
  source: string;
  /** Max cards to show */
  maxCards?: number;
  /** Card title field */
  titleField?: string;
  /** Card subtitle field */
  subtitleField?: string;
  /** Card value/main content field */
  valueField?: string;
  /** Card icon field */
  iconField?: string;
  /** Card image URL field */
  imageField?: string;
  /** Card color/status field */
  colorField?: string;
}

export interface TableRenderConfig {
  /** Source ID to display */
  source: string;
  /** Column definitions */
  columns: Array<{
    key: string;
    label: string;
    width?: string;
    align?: "left" | "center" | "right";
  }>;
  /** Max rows to show */
  maxRows?: number;
  /** Enable row click */
  clickable?: boolean;
}

export interface KVRenderConfig {
  /** Source ID to display */
  source: string;
  /** Key-value pairs to display (field -> label mapping) */
  fields: Record<string, string>;
  /** Layout: vertical stack or horizontal grid */
  layout?: "vertical" | "horizontal";
}

export interface FormRenderConfig {
  /** Form fields (uses config schema subset) */
  fields: string[];
  /** Tool to call on submit */
  submitTool: string;
  /** Submit button label */
  submitLabel?: string;
  /** How to display result */
  resultDisplay?: "text" | "json" | "table";
}

export type RenderConfig = 
  | { type: "ticker" } & TickerRenderConfig
  | { type: "feed" } & FeedRenderConfig
  | { type: "cards" } & CardsRenderConfig
  | { type: "table" } & TableRenderConfig
  | { type: "kv" } & KVRenderConfig
  | { type: "form" } & FormRenderConfig;

export interface PluginManifest {
  /** Unique identifier (slug format) */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description?: string;
  /** Icon name (lucide icon) */
  icon?: string;
  /** Author */
  author?: string;
  /** Version */
  version?: string;
}

export interface PluginBundle {
  /** Bundle format version */
  version: 1;
  /** Plugin type */
  type: "widget";
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Template type */
  template: PluginTemplate;
  /** Configuration schema */
  config: {
    schema: ConfigSchema;
    /** Default values (can be overridden by user) */
    defaults?: Record<string, unknown>;
  };
  /** Data sources */
  sources: DataSource[];
  /** Render configuration */
  render: RenderConfig;
}

export interface PluginInstance {
  id: string;
  name: string;
  description?: string;
  icon: string;
  template: PluginTemplate;
  bundle: PluginBundle;
  configValues: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PluginData {
  sources: Record<string, {
    data: unknown;
    fetchedAt: string;
    expiresAt: string;
    error?: string;
  }>;
  rendered?: unknown;  // Template-specific rendered data
}

export interface PluginState {
  plugin: PluginInstance;
  data: PluginData | null;
  loading: boolean;
  error: string | null;
  lastRefresh: number | null;
}

export interface ToolDefinition {
  /** Tool identifier (e.g., "web.search") */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Input schema */
  inputSchema: Record<string, ConfigField>;
  /** Output description */
  outputDescription: string;
  /** Rate limit (requests per minute) */
  rateLimit?: number;
  /** Whether this tool requires authentication */
  requiresAuth?: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  fetchedAt?: string;
}

export type ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput
) => Promise<ToolResult<TOutput>>;

export interface MakerQuestion {
  id: string;
  question: string;
  type: "text" | "select" | "confirm";
  options?: string[];
  required?: boolean;
}

export interface MakerConversation {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  currentBundle?: Partial<PluginBundle>;
  questions?: MakerQuestion[];
  complete: boolean;
}
