"use client";

/**
 * ToolCallDiff — renders a Monaco side-by-side diff for file-modifying tool
 * calls pending in the approval queue.
 *
 * Handled tool names:
 *   edit  (old_string / new_string)  — splices the replacement into current
 *                                       file content to synthesise before/after
 *   write (content)                  — original = current disk content (or ""),
 *                                       modified = args.content
 *
 * All other tools fall through to a raw JSON <pre> block identical to the
 * previous ApprovalsQueue rendering.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Lazy-load the DiffEditor — same pattern as MonacoEditor.tsx.
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => <div className="approval-diff-loading">Loading diff…</div>,
  },
);

// ── language detection ────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  sh: "shell", bash: "shell", zsh: "shell",
  ps1: "powershell",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  json: "json", jsonc: "jsonc",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  md: "markdown",
  sql: "sql",
  xml: "xml", svg: "xml",
  lua: "lua",
  r: "r",
};

function langFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

// ── arg-shape helpers ─────────────────────────────────────────────────────────

interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface WriteArgs {
  file_path: string;
  content: string;
}

function isEditArgs(args: unknown): args is EditArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    typeof (args as Record<string, unknown>).file_path === "string" &&
    typeof (args as Record<string, unknown>).old_string === "string" &&
    typeof (args as Record<string, unknown>).new_string === "string"
  );
}

function isWriteArgs(args: unknown): args is WriteArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    typeof (args as Record<string, unknown>).file_path === "string" &&
    typeof (args as Record<string, unknown>).content === "string"
  );
}

// ── text splicing ─────────────────────────────────────────────────────────────

/**
 * Synthesise the "after" text for an `edit` call.
 * Mirrors the behaviour of the real tool: finds the first (or all, when
 * replace_all=true) occurrence of old_string and replaces it with new_string.
 */
function applyEdit(source: string, args: EditArgs): string {
  if (args.replace_all) {
    return source.split(args.old_string).join(args.new_string);
  }
  const idx = source.indexOf(args.old_string);
  if (idx === -1) return source; // can't find it — return unchanged
  return source.slice(0, idx) + args.new_string + source.slice(idx + args.old_string.length);
}

// ── file fetch ────────────────────────────────────────────────────────────────

async function fetchFileContent(filePath: string): Promise<{ content: string; exists: boolean }> {
  const res = await fetch(
    `/api/tools/file-content?path=${encodeURIComponent(filePath)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return { content: "", exists: false };
  return res.json() as Promise<{ content: string; exists: boolean }>;
}

// ── component ─────────────────────────────────────────────────────────────────

interface ToolCallDiffProps {
  toolName: string;
  args: unknown;
}

type DiffState =
  | { kind: "loading" }
  | { kind: "diff"; filePath: string; original: string; modified: string; language: string }
  | { kind: "fallback" };

export function ToolCallDiff({ toolName, args }: ToolCallDiffProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [state, setState] = useState<DiffState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      // edit tool
      if (isEditArgs(args)) {
        const { content: diskContent } = await fetchFileContent(args.file_path);
        if (cancelled) return;
        const modified = applyEdit(diskContent, args);
        setState({
          kind: "diff",
          filePath: args.file_path,
          original: diskContent,
          modified,
          language: langFromPath(args.file_path),
        });
        return;
      }

      // write tool
      if (isWriteArgs(args)) {
        const { content: diskContent } = await fetchFileContent(args.file_path);
        if (cancelled) return;
        setState({
          kind: "diff",
          filePath: args.file_path,
          original: diskContent,
          modified: args.content,
          language: langFromPath(args.file_path),
        });
        return;
      }

      // anything else — fall through to raw JSON
      setState({ kind: "fallback" });
    }

    compute().catch(() => {
      if (!cancelled) setState({ kind: "fallback" });
    });

    return () => {
      cancelled = true;
    };
  }, [toolName, args]);

  // Raw JSON fallback (non-file tools or error)
  if (state.kind === "fallback") {
    return (
      <pre className="approval-args">
        {JSON.stringify(args, null, 2)}
      </pre>
    );
  }

  // Loading skeleton
  if (state.kind === "loading") {
    if (!isEditArgs(args) && !isWriteArgs(args)) {
      // Can tell immediately it won't be a diff — render raw right away.
      return (
        <pre className="approval-args">
          {JSON.stringify(args, null, 2)}
        </pre>
      );
    }
    return <div className="approval-diff-loading">Loading diff…</div>;
  }

  // Diff view
  return (
    <div className="approval-diff-wrap">
      <div className="approval-diff-header">
        <span className="approval-diff-path">{state.filePath}</span>
        <button
          type="button"
          className="approval-diff-raw-toggle"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? "hide raw" : "raw args"}
        </button>
      </div>

      {showRaw && (
        <pre className="approval-args">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      <div className="approval-diff-editor">
        <DiffEditor
          height="260px"
          language={state.language}
          original={state.original}
          modified={state.modified}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            fontSize: 12,
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, monospace",
            fontLigatures: true,
            scrollbar: { vertical: "auto", horizontal: "auto" },
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            // Hide the "editor toolbar" chrome that appears on the modified side
            renderOverviewRuler: false,
          }}
        />
      </div>
    </div>
  );
}
