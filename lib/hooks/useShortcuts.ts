"use client";

import { useEffect, useRef, useCallback } from "react";

// =============================================================================
// Types
// =============================================================================

export interface ShortcutOptions {
  /** Whether this shortcut is currently active. Defaults to true. */
  enabled?: boolean;
  /**
   * Higher priority handlers consume the event first.
   * E.g., CommandPalette's Escape (priority 100) beats SettingsDrawer's Escape (priority 10).
   * Defaults to 0.
   */
  priority?: number;
  /**
   * "always"    - fires regardless of focus target
   * "no-input"  - suppressed when focus is on input/textarea/contentEditable
   * Defaults to "always".
   */
  when?: "always" | "no-input";
  /** Human-readable label shown in command palette / settings. */
  label?: string;
}

interface Registration {
  id: number;
  combo: string;
  callback: () => void;
  options: Required<Pick<ShortcutOptions, "enabled" | "priority" | "when">> & {
    label?: string;
  };
}

// =============================================================================
// Module-level Registry
// =============================================================================

let nextId = 0;
const registry = new Map<number, Registration>();

function register(reg: Omit<Registration, "id">): number {
  const id = nextId++;
  registry.set(id, { ...reg, id });
  return id;
}

function unregister(id: number): void {
  registry.delete(id);
}

function updateRegistration(
  id: number,
  patch: Partial<Omit<Registration, "id">>
): void {
  const existing = registry.get(id);
  if (existing) {
    registry.set(id, { ...existing, ...patch });
  }
}

// =============================================================================
// Combo Parsing
// =============================================================================

/**
 * Normalizes a combo string like "mod+shift+c" into a canonical form.
 * "mod" maps to Meta on Mac, Ctrl elsewhere.
 */
interface ParsedCombo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // lowercased key name, e.g. "k", "escape", "arrowdown", "1"
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const result: ParsedCombo = {
    mod: false,
    shift: false,
    alt: false,
    key: "",
  };

  for (const part of parts) {
    switch (part) {
      case "mod":
      case "cmd":
      case "ctrl":
        result.mod = true;
        break;
      case "shift":
        result.shift = true;
        break;
      case "alt":
      case "option":
        result.alt = true;
        break;
      default:
        result.key = part;
    }
  }

  return result;
}

function matchesEvent(parsed: ParsedCombo, e: KeyboardEvent): boolean {
  const modHeld = e.metaKey || e.ctrlKey;
  if (parsed.mod !== modHeld) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  // Compare key (lowercased)
  const eventKey = e.key.toLowerCase();
  return parsed.key === eventKey;
}

// =============================================================================
// Input Focus Check
// =============================================================================

function isFocusedOnInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

// =============================================================================
// Global Listener (singleton)
// =============================================================================

let listenerAttached = false;

function ensureGlobalListener() {
  if (listenerAttached) return;
  listenerAttached = true;

  // Use capture phase so we run before any other handlers
  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      // Collect all matching registrations
      const matches: Registration[] = [];

      for (const reg of registry.values()) {
        if (!reg.options.enabled) continue;

        // Check "no-input" condition
        if (reg.options.when === "no-input" && isFocusedOnInput()) continue;

        const parsed = parseCombo(reg.combo);
        if (matchesEvent(parsed, e)) {
          matches.push(reg);
        }
      }

      if (matches.length === 0) return;

      // Sort by priority descending - highest priority wins
      matches.sort((a, b) => b.options.priority - a.options.priority);

      // Only the highest-priority handler fires (consumes the event)
      const winner = matches[0];
      e.preventDefault();
      e.stopPropagation();
      winner.callback();
    },
    true // capture phase
  );
}

// =============================================================================
// Public API: useShortcut Hook
// =============================================================================

/**
 * Register a keyboard shortcut.
 *
 * @param combo - Key combination string like "mod+k", "mod+shift+c", "escape", "1"
 * @param callback - Function to call when the shortcut fires
 * @param options - Configuration (enabled, priority, when, label)
 *
 * @example
 *   useShortcut("mod+k", () => setPaletteOpen(o => !o), { label: "Toggle command palette" });
 *   useShortcut("1", () => navigate("/deck/chat"), { when: "no-input", label: "Go to Chat" });
 *   useShortcut("escape", () => onClose(), { enabled: open, priority: 100, label: "Close palette" });
 */
export function useShortcut(
  combo: string,
  callback: () => void,
  options: ShortcutOptions = {}
): void {
  const {
    enabled = true,
    priority = 0,
    when = "always",
    label,
  } = options;

  const callbackRef = useRef(callback);
  const idRef = useRef<number | null>(null);

  // Keep callback ref current (avoids re-registering on every render)
  callbackRef.current = callback;

  // Stable wrapper that always calls the latest callback
  const stableCallback = useCallback(() => {
    callbackRef.current();
  }, []);

  // Register on mount, unregister on unmount
  useEffect(() => {
    ensureGlobalListener();

    const id = register({
      combo,
      callback: stableCallback,
      options: { enabled, priority, when, label },
    });
    idRef.current = id;

    return () => {
      unregister(id);
      idRef.current = null;
    };
    // Only re-register if the combo itself changes (rare)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, stableCallback]);

  // Update options reactively without re-registering
  useEffect(() => {
    if (idRef.current !== null) {
      updateRegistration(idRef.current, {
        options: { enabled, priority, when, label },
      });
    }
  }, [enabled, priority, when, label]);
}

// =============================================================================
// Public API: getRegisteredShortcuts
// =============================================================================

export interface RegisteredShortcut {
  combo: string;
  label?: string;
  enabled: boolean;
  priority: number;
}

/**
 * Returns all currently registered shortcuts.
 * Useful for building a discoverable shortcut list in the command palette or settings.
 */
export function getRegisteredShortcuts(): RegisteredShortcut[] {
  const shortcuts: RegisteredShortcut[] = [];

  for (const reg of registry.values()) {
    shortcuts.push({
      combo: reg.combo,
      label: reg.options.label,
      enabled: reg.options.enabled,
      priority: reg.options.priority,
    });
  }

  // Sort by combo for consistent ordering
  shortcuts.sort((a, b) => a.combo.localeCompare(b.combo));
  return shortcuts;
}
