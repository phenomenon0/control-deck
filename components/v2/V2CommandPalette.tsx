"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRegisteredCommands } from "@/lib/hooks/useCommands";
import { useShortcut } from "@/lib/hooks/useShortcuts";

interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  keywords?: string;
  shortcut?: string;
  action: () => void;
}

const DESTINATIONS = [
  ["dashboard", "Deck", "/v2/dashboard", "home overview"],
  ["chat", "Chat", "/v2/chat", "conversation assistant"],
  ["models", "Models", "/v2/models", "inference catalog install"],
  ["visual", "Visual", "/v2/visual", "image gallery generate edit upscale"],
  ["audio", "Audio", "/v2/audio", "music sound"],
  ["voice", "Voice", "/v2/voice", "speech studio pipeline"],
  ["runs", "Runs", "/v2/runs", "history artifacts timeline"],
  ["control", "Control", "/v2/control", "approvals policy"],
  ["system", "System", "/v2/system", "hardware gpu vram resources"],
  ["workspace", "Workspace", "/v2/workspace", "panes notes canvas"],
  ["terminal", "Terminal", "/v2/terminal", "shell console"],
  ["settings", "Settings", "/v2/settings", "preferences appearance shortcuts"],
] as const;

function matches(command: PaletteCommand, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${command.label} ${command.category} ${command.keywords ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export default function V2CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const registered = useRegisteredCommands();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const commands = useMemo<PaletteCommand[]>(() => {
    const current: PaletteCommand[] = [];
    const other: PaletteCommand[] = [];
    for (const command of registered) {
      const entry: PaletteCommand = {
        id: `registered:${command.id}`,
        label: command.label,
        category: command.scope && pathname.startsWith(command.scope)
          ? "In this surface"
          : command.category,
        shortcut: command.shortcut,
        action: () => { void command.action(); },
      };
      (entry.category === "In this surface" ? current : other).push(entry);
    }

    const navigation: PaletteCommand[] = DESTINATIONS.map(([id, label, href, keywords]) => ({
      id: `navigate:${id}`,
      label: `Go to ${label}`,
      category: "Navigation",
      keywords,
      action: () => router.push(href),
    }));

    const control: PaletteCommand[] = [
      {
        id: "navigate:tools",
        label: "Open Tool Catalog",
        category: "Control",
        keywords: "capabilities manifest MCP",
        action: () => router.push("/v2/control?tab=tools"),
      },
      {
        id: "navigate:approvals",
        label: "Open Approval Queue",
        category: "Control",
        keywords: "permissions policy gate",
        action: () => router.push("/v2/control"),
      },
    ];

    return [...current, ...navigation, ...control, ...other];
  }, [pathname, registered, router]);

  const filtered = useMemo(
    () => commands.filter((command) => matches(command, query)),
    [commands, query],
  );
  const activeIndex = filtered.length === 0 ? 0 : Math.min(selected, filtered.length - 1);

  const close = () => setOpen(false);
  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    command.action();
    close();
  };

  useShortcut("mod+k", () => {
    if (open) {
      close();
      return;
    }
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setQuery("");
    setSelected(0);
    setOpen(true);
  }, {
    when: "no-input",
    label: "Toggle command palette",
  });
  useShortcut("escape", close, {
    enabled: open,
    priority: 100,
    label: "Close command palette",
  });
  useShortcut("arrowdown", () => {
    setSelected((value) => filtered.length === 0 ? 0 : (value + 1) % filtered.length);
  }, { enabled: open, priority: 100, label: "Command palette: next" });
  useShortcut("arrowup", () => {
    setSelected((value) => filtered.length === 0 ? 0 : (value - 1 + filtered.length) % filtered.length);
  }, { enabled: open, priority: 100, label: "Command palette: previous" });
  useShortcut("enter", () => run(filtered[activeIndex]), {
    enabled: open,
    priority: 100,
    label: "Command palette: run selected",
  });

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    const item = dialogRef.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div className="v2cmd" onMouseDown={close}>
      <div className="v2cmd__scrim" aria-hidden />
      <div
        ref={dialogRef}
        className="v2cmd__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2cmd-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? [],
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="v2cmd__search">
          <Search size={17} strokeWidth={1.8} aria-hidden />
          <label id="v2cmd-title" htmlFor="v2cmd-input">Command palette</label>
          <input
            ref={inputRef}
            id="v2cmd-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Find a surface or command…"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="v2cmd-results"
            aria-activedescendant={filtered[activeIndex] ? `v2cmd-option-${activeIndex}` : undefined}
          />
          <kbd>esc</kbd>
        </div>

        <div id="v2cmd-results" className="v2cmd__results" role="listbox">
          {filtered.map((command, index) => {
            const showCategory = index === 0 || filtered[index - 1]?.category !== command.category;
            return (
              <div key={command.id} className="v2cmd__entry">
                {showCategory && <div className="v2cmd__category">{command.category}</div>}
                <button
                  id={`v2cmd-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-command-index={index}
                  className={index === activeIndex ? "is-selected" : undefined}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="v2cmd__empty">No commands match “{query}”.</div>
          )}
        </div>

        <div className="v2cmd__footer" aria-hidden>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
