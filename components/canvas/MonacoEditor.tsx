"use client";

/**
 * Monaco Editor wrapper for canvas code editing
 * 
 * Features:
 * - Syntax highlighting for 50+ languages
 * - Dark theme matching control-deck
 * - Mini-map toggle
 * - Line numbers
 * - IntelliSense (basic)
 * - Keyboard shortcuts (Cmd+S to save, Cmd+Enter to run)
 */

import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount, OnChange, Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

// Dynamically import Monaco to avoid SSR issues
const Editor = dynamic(
  () => import("@monaco-editor/react").then(mod => mod.default),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        Loading editor...
      </div>
    ),
  }
);

// =============================================================================
// Language Mapping
// =============================================================================

const LANGUAGE_MAP: Record<string, string> = {
  // Common
  "js": "javascript",
  "jsx": "javascript",
  "ts": "typescript",
  "tsx": "typescript",
  "py": "python",
  "python3": "python",
  "rb": "ruby",
  "go": "go",
  "golang": "go",
  "rs": "rust",
  "java": "java",
  "c": "c",
  "cpp": "cpp",
  "c++": "cpp",
  "cs": "csharp",
  "csharp": "csharp",
  "php": "php",
  "swift": "swift",
  "kt": "kotlin",
  "kotlin": "kotlin",
  "scala": "scala",
  "r": "r",
  "lua": "lua",
  "perl": "perl",
  "sh": "shell",
  "bash": "shell",
  "zsh": "shell",
  "fish": "shell",
  "ps1": "powershell",
  "powershell": "powershell",
  
  // Web
  "html": "html",
  "htm": "html",
  "css": "css",
  "scss": "scss",
  "sass": "scss",
  "less": "less",
  "json": "json",
  "jsonc": "jsonc",
  "xml": "xml",
  "svg": "xml",
  "yaml": "yaml",
  "yml": "yaml",
  "toml": "toml",
  
  // Config/Data
  "md": "markdown",
  "markdown": "markdown",
  "sql": "sql",
  "graphql": "graphql",
  "gql": "graphql",
  "dockerfile": "dockerfile",
  "docker": "dockerfile",
  "makefile": "makefile",
  "make": "makefile",
  
  // Other
  "asm": "asm",
  "wat": "wat",
  "wasm": "wat",
  "sol": "solidity",
  "solidity": "solidity",
  "zig": "zig",
  "nim": "nim",
  "elixir": "elixir",
  "ex": "elixir",
  "erl": "erlang",
  "erlang": "erlang",
  "clj": "clojure",
  "clojure": "clojure",
  "hs": "haskell",
  "haskell": "haskell",
  "ml": "fsharp",
  "ocaml": "fsharp",
  "fsharp": "fsharp",
  "dart": "dart",
  "julia": "julia",
  "jl": "julia",
};

function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase().trim();
  return LANGUAGE_MAP[lower] || lower;
}

// =============================================================================
// Dynamic Theme from CSS Variables
// =============================================================================

/** Read a CSS custom property value from the document root. */
function getCSSVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Convert a CSS color value to a hex string Monaco can consume.
 * Handles #hex, rgb(), and rgba() — returns fallback for empty/unknown.
 */
function cssColorToHex(cssValue: string, fallback: string): string {
  if (!cssValue) return fallback;
  if (cssValue.startsWith("#")) return cssValue;
  if (typeof document === "undefined") return fallback;
  const el = document.createElement("div");
  el.style.color = cssValue;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return fallback;
}

/** Build and register the Monaco theme using current CSS variable values. */
function defineCustomTheme(monaco: Monaco) {
  const bgPrimary = cssColorToHex(getCSSVar("--bg-primary"), "#1C1B18");
  const bgSecondary = cssColorToHex(getCSSVar("--bg-secondary"), "#24231F");
  const bgTertiary = cssColorToHex(getCSSVar("--bg-tertiary"), "#2C2A25");
  const textPrimary = cssColorToHex(getCSSVar("--text-primary"), "#f9fafb");
  const textMuted = cssColorToHex(getCSSVar("--text-muted"), "#7A7265");
  const accent = cssColorToHex(getCSSVar("--accent"), "#D4A574");
  const borderBright = cssColorToHex(getCSSVar("--border-bright"), "#3f3f46");
  const success = cssColorToHex(getCSSVar("--success"), "#22c55e");
  const error = cssColorToHex(getCSSVar("--error"), "#ef4444");

  monaco.editor.defineTheme("control-deck-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fcd34d" },
      { token: "type", foreground: "67e8f9" },
      { token: "function", foreground: "93c5fd" },
      { token: "variable", foreground: textPrimary.replace("#", "") },
      { token: "operator", foreground: "f472b6" },
    ],
    colors: {
      "editor.background": bgSecondary,
      "editor.foreground": textPrimary,
      "editor.lineHighlightBackground": bgTertiary,
      "editor.selectionBackground": `${accent}80`,
      "editorCursor.foreground": textPrimary,
      "editorLineNumber.foreground": textMuted,
      "editorLineNumber.activeForeground": textPrimary,
      "editorIndentGuide.background": bgTertiary,
      "editorIndentGuide.activeBackground": borderBright,
      "editor.inactiveSelectionBackground": `${bgTertiary}80`,
      "editorBracketMatch.background": `${accent}40`,
      "editorBracketMatch.border": accent,
      "scrollbarSlider.background": `${borderBright}80`,
      "scrollbarSlider.hoverBackground": `${textMuted}80`,
      "scrollbarSlider.activeBackground": `${textMuted}80`,
      "minimap.background": bgSecondary,
      "minimapGutter.addedBackground": success,
      "minimapGutter.modifiedBackground": accent,
      "minimapGutter.deletedBackground": error,
    },
  });
}

// =============================================================================
// Props
// =============================================================================

interface MonacoEditorProps {
  code: string;
  language: string;
  onChange?: (code: string) => void;
  onRun?: () => void;
  onSave?: (code: string) => void;
  readOnly?: boolean;
  showMinimap?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function MonacoEditor({
  code,
  language,
  onChange,
  onRun,
  onSave,
  readOnly = false,
  showMinimap = false,
  lineNumbers = true,
  wordWrap = false,
  fontSize = 13,
  className = "",
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  const normalizedLanguage = normalizeLanguage(language);
  
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Define and apply custom theme
    defineCustomTheme(monaco);
    monaco.editor.setTheme("control-deck-dark");
    
    // Add keybindings
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (onSave) {
        onSave(editor.getValue());
      }
    });
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (onRun) {
        onRun();
      }
    });
    
    // Focus editor
    editor.focus();
    setIsReady(true);
  }, [onRun, onSave]);
  
  const handleChange: OnChange = useCallback((value) => {
    if (onChange && value !== undefined) {
      onChange(value);
    }
  }, [onChange]);
  
  // Watch for theme changes and rebuild Monaco theme
  useEffect(() => {
    if (!monacoRef.current) return;

    const observer = new MutationObserver(() => {
      if (monacoRef.current) {
        defineCustomTheme(monacoRef.current);
        monacoRef.current.editor.setTheme("control-deck-dark");
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => observer.disconnect();
  }, [isReady]);

  // Update editor options when props change
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        readOnly,
        minimap: { enabled: showMinimap },
        lineNumbers: lineNumbers ? "on" : "off",
        wordWrap: wordWrap ? "on" : "off",
        fontSize,
      });
    }
  }, [readOnly, showMinimap, lineNumbers, wordWrap, fontSize]);
  
  return (
    <div className={`h-full w-full ${className}`}>
      <Editor
        height="100%"
        language={normalizedLanguage}
        value={code}
        onChange={handleChange}
        onMount={handleEditorMount}
        theme="vs-dark" // Will be overridden by our custom theme on mount
        loading={
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
            Loading editor...
          </div>
        }
        options={{
          readOnly,
          minimap: { enabled: showMinimap },
          lineNumbers: lineNumbers ? "on" : "off",
          wordWrap: wordWrap ? "on" : "off",
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace",
          fontLigatures: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          renderLineHighlight: "line",
          padding: { top: 12, bottom: 12 },
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
}

export default MonacoEditor;
