"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./atlas-v2.css";
import { useThreads } from "@/lib/hooks/useThreads";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import {
  groupThreadsByDate,
  setStoredThreads,
  type Thread,
  type Message,
} from "@/lib/chat/helpers";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { Markdown } from "@/lib/chat-v2/markdown";
import { parseAssistant, hasIframePreview, type CanvasObject } from "@/lib/chat-v2/objects";

/* Atlas icon dialect — path data only; the .ico class supplies stroke/fill. */
const P: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
  mic: '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7"/>',
  spark:
    '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19"/>',
};

function Ico({ name, sm, style }: { name: string; sm?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      className={"ico" + (sm ? " ico--sm" : "")}
      viewBox="0 0 24 24"
      style={style}
      dangerouslySetInnerHTML={{ __html: P[name] || "" }}
    />
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read the deck's real user prefs (localStorage `deck.prefs`). No provider is
 *  mounted on this standalone route, so we read the persisted store directly —
 *  same shape DeckSettingsProvider writes. */
function readPrefs(): {
  model: string;
  systemPrompt?: string;
  providerId?: "ollama" | "vllm" | "llamacpp" | "lm-studio";
  preset?: "quick" | "balanced" | "quality";
} {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    const pid = p.providerId;
    return {
      model: typeof p.model === "string" ? p.model : "",
      systemPrompt: typeof p.systemPrompt === "string" ? p.systemPrompt : undefined,
      providerId:
        pid === "ollama" || pid === "vllm" || pid === "llamacpp" || pid === "lm-studio" ? pid : undefined,
      preset:
        p.localModelPreset === "quick" || p.localModelPreset === "balanced" || p.localModelPreset === "quality"
          ? p.localModelPreset
          : undefined,
    };
  } catch {
    return { model: "" };
  }
}

const iconForKind = (kind: string) =>
  kind === "image" ? "image" : kind === "audio" ? "music" : kind === "model" ? "cpu" : kind === "video" ? "file" : "code";

/* Empty-state seeds — click to pre-fill the composer. */
const SEEDS: Array<{ icon: string; label: string; text: string }> = [
  { icon: "code", label: "run a snippet", text: "Write and run a short Python script that " },
  { icon: "image", label: "make an image", text: "Generate an image of " },
  { icon: "spark", label: "explain something", text: "Explain how " },
];

interface ExecState {
  running: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  preview?: { bundled?: string; html?: string };
  images?: Array<{ name: string; mimeType: string; data: string }>;
}

export default function ChatV2Page() {
  const {
    threads, activeThreadId, messages, setMessages, setThreads,
    setActiveThreadId, selectThread, fallbackThreadId, resetFallbackThreadId,
  } = useThreads();

  const agentRun = useAgentRun();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<{ text: string; running: boolean }>({ text: "", running: false });
  // AUTO-SWAP chain — per-step status lines emitted by the image tool
  // (StepStarted via /api/agui/stream) plus the lazy chat-model reload.
  const [swapSteps, setSwapSteps] = useState<string[]>([]);

  // Canvas
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasObject, setCanvasObject] = useState<CanvasObject | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [canvasFull, setCanvasFull] = useState(false);
  const [execById, setExecById] = useState<Record<string, ExecState>>({});

  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Reset transient UI when switching threads.
  useEffect(() => {
    setLive({ text: "", running: false });
    setSwapSteps([]);
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
  }, [activeThreadId]);

  // Tap the AUTO-SWAP chain: the image tool emits StepStarted events to the
  // hub (unload/free/generate/ready). Those don't ride the /api/chat SSE, so
  // subscribe to the per-thread hub stream while a run is live and fold the
  // step descriptions into the visible swap chain. Only StepStarted is handled
  // here — everything else already arrives via useAgentRun, so no duplication.
  useEffect(() => {
    if (!agentRun.isRunning || !activeThreadId) return;
    const es = new EventSource(`/api/agui/stream?threadId=${encodeURIComponent(activeThreadId)}`);
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data as string) as { type?: string; description?: string };
        if (evt.type === "StepStarted" && typeof evt.description === "string") {
          const line = evt.description;
          setSwapSteps((prev) => (prev.includes(line) ? prev : [...prev, line]));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, [agentRun.isRunning, activeThreadId]);

  // Keep the flow pinned to the newest content.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const autogrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const activeThread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null;
  const chatTitle = activeThread?.title || "New thread";

  const threadGroups = useMemo(() => {
    const filtered = query.trim()
      ? threads.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
      : threads;
    return groupThreadsByDate(filtered);
  }, [threads, query]);

  // Count renderable objects across the loaded thread (for the header rail).
  const renderCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => (m.role === "assistant" ? n + parseAssistant(m.id, m.content, m.artifacts).objects.length : n),
        0,
      ),
    [messages],
  );
  const modelLabel = agentRun.state.resolvedModel || readPrefsModel() || "auto";

  function newThread() {
    resetFallbackThreadId();
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
    setLive({ text: "", running: false });
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
    taRef.current?.focus();
  }

  /** Pre-fill the composer from an empty-state seed and focus it. */
  function seed(text: string) {
    setInput(text);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autogrow();
    });
  }

  function openObject(obj: CanvasObject) {
    setCanvasObject(obj);
    setCanvasOpen(true);
    setTab(obj.source === "artifact" || hasIframePreview(obj) || obj.executable ? "preview" : "code");
  }

  async function runObject(obj: CanvasObject) {
    if (obj.source !== "code" || !obj.executable) return;
    setExecById((e) => ({ ...e, [obj.id]: { running: true } }));
    try {
      const res = await fetch("/api/code/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: obj.language, code: obj.code }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setExecById((e) => ({
          ...e,
          [obj.id]: { running: false, stderr: `execute failed — HTTP ${res.status}${t ? ` · ${t.slice(0, 300)}` : ""}`, exitCode: res.status },
        }));
        return;
      }
      const d = await res.json();
      setExecById((e) => ({
        ...e,
        [obj.id]: {
          running: false,
          stdout: d.stdout,
          stderr: d.stderr,
          exitCode: d.exitCode,
          durationMs: d.durationMs,
          preview: d.preview,
          images: d.images,
        },
      }));
    } catch (err) {
      setExecById((e) => ({
        ...e,
        [obj.id]: { running: false, stderr: err instanceof Error ? err.message : "execution failed", exitCode: 1 },
      }));
    }
  }

  // Auto-run an executable object the first time its preview is shown.
  useEffect(() => {
    if (!canvasObject || tab !== "preview") return;
    if (canvasObject.source !== "code" || !canvasObject.executable) return;
    if (execById[canvasObject.id]) return;
    void runObject(canvasObject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasObject, tab]);

  function persistMessage(threadId: string, msg: Message, runId?: string | null) {
    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "message",
        threadId,
        id: msg.id,
        role: msg.role,
        content: msg.content,
        ...(runId ? { runId } : {}),
      }),
    }).catch((err) => console.error("[chat-v2] persist failed:", err));
  }

  /**
   * Lazy reload for the AUTO-SWAP flow. If the chat LLM was evicted to make
   * room for image gen, it's absent from Ollama's resident set. Paid only when
   * the user actually chats next (skipped if they ask for another image).
   * Gated to Ollama — llama-swap auto-loads on request and other engines
   * warm implicitly, so only Ollama needs an explicit pre-run reload.
   */
  async function ensureChatModelResident(prefs: ReturnType<typeof readPrefs>): Promise<void> {
    if (prefs.providerId !== "ollama" || !prefs.model) return;
    const isResident = async (): Promise<boolean | null> => {
      try {
        const r = await fetch("/api/ollama/ps", { cache: "no-store" });
        if (!r.ok) return null;
        const d = (await r.json()) as { models?: Array<{ name?: string; model?: string }> };
        return (d.models ?? []).some((m) => m.name === prefs.model || m.model === prefs.model);
      } catch {
        return null;
      }
    };
    const resident = await isResident();
    if (resident !== false) return; // resident, or Ollama unreachable → let the run proceed
    // Not resident — reload and wait until it's back (or 60s), with status.
    setSwapSteps((s) => [...s, `reloading ${prefs.model}…`]);
    await fetch("/api/ollama/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: prefs.model }),
    }).catch(() => {});
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await sleep(1000);
      if ((await isResident()) === true) {
        setSwapSteps((s) => [...s, `${prefs.model} ready`]);
        return;
      }
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || agentRun.isRunning) return;

    // Resolve (create) the thread — mirrors ChatSurface.onSubmit.
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = fallbackThreadId;
      const newT: Thread = {
        id: threadId,
        title: trimmed.slice(0, 50) + (trimmed.length > 50 ? "..." : ""),
        lastMessageAt: new Date().toISOString(),
      };
      setThreads((prev) => {
        const updated = [newT, ...prev];
        setStoredThreads(updated);
        return updated;
      });
      setActiveThreadId(threadId);
    }

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    persistMessage(threadId, userMessage);

    const prefs = readPrefs();
    const apiMessages = nextMessages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));
    const runId = crypto.randomUUID();

    setLive({ text: "", running: true });
    // Clear the previous turn's swap chain, then lazily reload the chat model
    // if it was evicted for an image on a prior turn — before the run starts.
    setSwapSteps([]);
    await ensureChatModelResident(prefs);
    const result = await agentRun.send(trimmed, {
      messages: apiMessages,
      threadId,
      runId,
      model: prefs.model,
      providerId: prefs.providerId,
      systemPrompt: prefs.systemPrompt,
      preset: prefs.preset,
      hooks: { onTextDelta: (delta) => setLive((l) => ({ ...l, text: l.text + delta })) },
    });

    if (result.ok && result.fullText) {
      const assistant: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.fullText,
        artifacts: result.artifacts.length ? result.artifacts : undefined,
      };
      setMessages((prev) => [...prev, assistant]);
      setLive({ text: "", running: false });
      persistMessage(result.threadId, assistant, result.runId);
      const { objects } = parseAssistant(assistant.id, assistant.content, assistant.artifacts);
      if (objects.length) openObject(objects[0]);
    } else {
      // Graceful degrade — the model backend (agent-ts) is offline. Stream a
      // labelled stub so the wired data path still shows a full turn instead
      // of crashing. Inference is the only thing that's down.
      await streamStub(trimmed, result.threadId);
    }
  }

  async function streamStub(userText: string, threadId: string) {
    const stub =
      `*Stubbed reply — the model backend (agent-ts) isn't reachable, so no live model produced this. ` +
      `Threads, persistence, and the streaming pipeline are wired to the real deck backend; only inference is offline.*\n\n` +
      `You said: "${userText}"`;
    let acc = "";
    for (const token of stub.split(/(\s+)/)) {
      acc += token;
      setLive({ text: acc, running: true });
      await sleep(12);
    }
    const assistant: Message = { id: crypto.randomUUID(), role: "assistant", content: stub };
    setMessages((prev) => [...prev, assistant]);
    setLive({ text: "", running: false });
    persistMessage(threadId, assistant);
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (agentRun.isRunning) return;
      void sendText(input);
    }
  }

  function retryLast() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void sendText(lastUser.content);
  }

  const exec = canvasObject ? execById[canvasObject.id] : undefined;

  return (
    <div className="av2">
      <div className="app" data-canvas={canvasOpen ? "open" : "closed"}>

        {/* threads */}
        <aside className="side">
          <div className="side__head">
            <h1>Threads</h1>
            <a className="new" onClick={newThread}><Ico name="plus" sm />new</a>
          </div>
          <div className="side__search">
            <span className="s-ico"><Ico name="search" sm /></span>
            <input
              className="field__input"
              placeholder="search threads…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="side__list">
            {threadGroups.length === 0 && (
              <div className="shelf" style={{ opacity: 0.6 }}>no threads yet</div>
            )}
            {threadGroups.map((g) => (
              <div key={g.label}>
                <div className="shelf">{g.label.toLowerCase()}</div>
                {g.threads.map((t) => (
                  <div
                    key={t.id}
                    className={"conv" + (t.id === activeThreadId ? " is-active" : "")}
                    onClick={() => selectThread(t.id)}
                  >
                    <span className="conv__name">{t.title}</span>
                    <span className="conv__prev">
                      {new Date(t.lastMessageAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="side__me"><b>Jethro A.</b><a>settings</a></div>
        </aside>

        {/* chat */}
        <main className="main">
          <div className="top">
            <h2>{chatTitle}</h2>
            <div className="rail">
              <b>{modelLabel}</b> · routed local · {messages.length} {messages.length === 1 ? "turn" : "turns"}
              {renderCount > 0 ? ` · ${renderCount} ${renderCount === 1 ? "render" : "renders"}` : ""}
            </div>
          </div>
          <div className="thread" ref={threadRef}>
            <div className="flow">
              {messages.length === 0 && !live.running && (
                <div className="empty">
                  <span className="empty__mark"><Ico name="spark" /></span>
                  <h3>New thread</h3>
                  <p className="empty__lead">
                    The well climbs when you focus it. Ask a question, paste code to run, or request an
                    image — renders dock in the canvas beside you.
                  </p>
                  <div className="empty__seeds">
                    {SEEDS.map((s) => (
                      <button key={s.label} type="button" className="seed" onClick={() => seed(s.text)}>
                        <Ico name={s.icon} sm />{s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) =>
                msg.role === "user" ? (
                  <div className="u" key={msg.id}>
                    <div className="well">{msg.content}</div>
                    <div className="meta">you</div>
                  </div>
                ) : (
                  <AssistantTurn key={msg.id} msg={msg} onOpen={openObject} onRetry={retryLast} />
                ),
              )}

              {swapSteps.length > 0 && (
                <div className="a" style={{ opacity: 0.9 }}>
                  <div className="meta"><span className="spark"><Ico name="cpu" /></span><b>auto-swap</b></div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
                    {swapSteps.map((s, i) => (
                      <div key={i}>◦ {s}</div>
                    ))}
                  </div>
                </div>
              )}

              {(live.running || live.text) && (
                <div className="a a--live">
                  <div className="meta"><span className="spark spark--live"><Ico name="spark" /></span><b>atlas</b></div>
                  {live.text ? (
                    <Markdown content={live.text} />
                  ) : (
                    <p className="writing">atlas is writing<span className="ellip"><i /><i /><i /></span></p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="compose">
            <div className="compose__inner">
              <div className="compose__field">
                <button className="iconbtn iconbtn--flush" aria-label="Attach file"><Ico name="paperclip" /></button>
                <textarea
                  ref={taRef}
                  onInput={autogrow}
                  onKeyDown={onComposerKey}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="field__input"
                  rows={1}
                  placeholder="reply — the well climbs when you focus it…"
                />
                <button className="iconbtn iconbtn--flush" aria-label="Voice / dictate"><Ico name="mic" /></button>
                {agentRun.isRunning ? (
                  <button className="btn btn--primary send" onClick={() => agentRun.stop()}>
                    <Ico name="stop" />stop
                  </button>
                ) : (
                  <button className="btn btn--primary send" onClick={() => void sendText(input)}>
                    <Ico name="send" />send
                  </button>
                )}
              </div>
            </div>
            <div className="compose__bar">
              <span className="tag"><Ico name="cpu" style={{ width: 12, height: 12 }} />local</span>
              <span className="tag"><Ico name="music" style={{ width: 12, height: 12 }} />{modelLabel}</span>
              <span className="tag tag--accent"><Ico name="sliders" style={{ width: 12, height: 12 }} />tweaks</span>
              <span className="grow" />
              <span className="hint">↵ sends · shift-↵ newline</span>
            </div>
          </div>
        </main>

        {/* canvas */}
        <section className={"canvas" + (canvasFull ? " is-full" : "")}>
          {canvasObject && (
            <CanvasStage
              obj={canvasObject}
              tab={tab}
              setTab={setTab}
              exec={exec}
              full={canvasFull}
              onToggleFull={() => setCanvasFull((f) => !f)}
              onRefresh={() => { setExecById((e) => { const c = { ...e }; delete c[canvasObject.id]; return c; }); void runObject(canvasObject); }}
              onClose={() => { setCanvasOpen(false); setCanvasFull(false); }}
            />
          )}
          {!canvasObject && <EmptyCanvas onClose={() => setCanvasOpen(false)} />}
        </section>

      </div>
    </div>
  );
}

/* ─── assistant turn: prose + object cards + actions ─── */
function AssistantTurn({
  msg,
  onOpen,
  onRetry,
}: {
  msg: Message;
  onOpen: (o: CanvasObject) => void;
  onRetry: () => void;
}) {
  const { prose, objects } = useMemo(
    () => parseAssistant(msg.id, msg.content, msg.artifacts),
    [msg.id, msg.content, msg.artifacts],
  );
  const [copied, setCopied] = useState(false);

  return (
    <div className="a">
      <div className="meta"><span className="spark"><Ico name="spark" /></span><b>atlas</b></div>
      {prose && <Markdown content={prose} />}
      {objects.map((obj) => (
        <div className="obj" key={obj.id} data-source={obj.source} onClick={() => onOpen(obj)}>
          <span className="obj__ic"><Ico name={iconForKind(obj.kind)} /></span>
          <span className="obj__t"><b>{obj.title}</b><span>{obj.meta}</span></span>
          <span className="obj__go">{obj.source === "code" && obj.executable ? "run" : "open"}<Ico name="arrow-right" sm /></span>
        </div>
      ))}
      <div className="acts-row">
        <a onClick={() => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Ico name="copy" sm />{copied ? "copied" : "copy"}
        </a>
        <a onClick={onRetry}><Ico name="refresh" sm />retry</a>
        <a><Ico name="bookmark" sm />save_to_notes</a>
      </div>
    </div>
  );
}

/* ─── canvas: real artifact / code-exec renderer inside Atlas chrome ─── */
function CanvasStage({
  obj,
  tab,
  setTab,
  exec,
  full,
  onToggleFull,
  onRefresh,
  onClose,
}: {
  obj: CanvasObject;
  tab: "preview" | "code";
  setTab: (t: "preview" | "code") => void;
  exec?: ExecState;
  full: boolean;
  onToggleFull: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const running = exec?.running;
  const status = running ? "running" : "ready";
  const previewHtml = exec?.preview?.bundled || exec?.preview?.html;

  const copyText = obj.code || obj.artifact?.url || "";
  const download = () => {
    if (obj.artifact) {
      const a = document.createElement("a");
      a.href = obj.artifact.url;
      a.download = obj.artifact.name;
      a.click();
      return;
    }
    if (obj.code) {
      const blob = new Blob([obj.code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = obj.title.replace(/\W+/g, "_") + ".txt";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      <div className="canvas__head">
        <span className="canvas__title">{obj.title}</span>
        <span className="canvas__kind">{obj.kind}</span>
        <span className="canvas__status" data-state={running ? "running" : "ready"}>{status}</span>
        <div className="canvas__seg">
          <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>preview</button>
          <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>code</button>
        </div>
        <div className="canvas__tools">
          {obj.source === "code" && obj.executable && (
            <button className="iconbtn iconbtn--flush" aria-label="Refresh" onClick={onRefresh}><Ico name="refresh" /></button>
          )}
          <button className="iconbtn iconbtn--flush" aria-label="Copy" onClick={() => navigator.clipboard.writeText(copyText)}><Ico name="copy" /></button>
          <button className="iconbtn iconbtn--flush" aria-label="Download" onClick={download}><Ico name="download" /></button>
          <button className={"iconbtn iconbtn--flush" + (full ? " on" : "")} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} onClick={onToggleFull}><Ico name="maximize" /></button>
          <button className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
        </div>
      </div>

      <div className="canvas__stage">
        {tab === "preview" ? (
          obj.source === "artifact" && obj.artifact ? (
            <div className="plate" style={{ padding: 12 }}>
              <ArtifactRenderer artifact={obj.artifact} />
            </div>
          ) : previewHtml ? (
            <div className="plate">
              <div className="plate__view">
                <iframe
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin"
                  title={obj.title}
                  style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#fff" }}
                />
              </div>
              <div className="plate__cap"><b>{obj.title}</b><span>· live preview{exec?.durationMs != null ? ` · ${exec.durationMs}ms` : ""}</span></div>
            </div>
          ) : exec?.images?.length ? (
            <div className="plate" style={{ padding: 12 }}>
              {exec.images.map((img, i) => (
                <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto 8px" }} />
              ))}
              <div className="plate__cap"><b>{obj.title}</b><span>· {exec.images.length} image{exec.images.length === 1 ? "" : "s"}</span></div>
            </div>
          ) : (
            <div className="plate" style={{ maxWidth: 620 }}>
              <pre style={{ margin: 0, borderRadius: 0, boxShadow: "none", border: "none" }}>
                <code>
                  {running
                    ? "running…"
                    : exec
                      ? (exec.stdout || "") + (exec.stderr ? `\n${exec.stderr}` : "") || "(no output)"
                      : "click preview to run"}
                </code>
              </pre>
              <div className="plate__cap">
                <b>{obj.title}</b>
                <span>· {running ? "executing" : exec ? `exit ${exec.exitCode ?? 0}${exec.durationMs != null ? ` · ${exec.durationMs}ms` : ""}` : "idle"}</span>
              </div>
            </div>
          )
        ) : (
          <div className="plate" style={{ maxWidth: 680 }}>
            <pre style={{ margin: 0, borderRadius: 0, boxShadow: "none", border: "none" }}>
              <code>{obj.code || obj.artifact?.url || ""}</code>
            </pre>
            <div className="plate__cap"><b>{obj.title}</b><span>· {obj.meta}</span></div>
          </div>
        )}
      </div>

      <div className="canvas__foot">
        <span>{obj.source === "code" ? (obj.language || "code") : (obj.artifact?.mimeType || obj.kind)}</span>
        <span>·</span>
        <span>{obj.source === "code" ? "code → preview" : "artifact → preview"}</span>
        <span className="grow" />
        <a onClick={onToggleFull}><Ico name="maximize" sm /> {full ? "exit full screen" : "full screen"}</a><span>·</span><a><Ico name="bookmark" sm /> save_to_notes</a>
      </div>
    </>
  );
}

/* ─── empty canvas — the ambient spectrum stands in until a render exists ─── */
function EmptyCanvas({ onClose }: { onClose: () => void }) {
  const spectrum = useMemo(() => {
    const rows = [];
    for (let i = 0; i < 34; i++) {
      const y = 8 + i * 7;
      const amp = 30 * Math.abs(Math.sin(i * 0.5)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.17)));
      const x0 = 20 + (30 - amp);
      const x1 = 540 - (30 - amp) * 0.3;
      const op = (0.25 + 0.6 * Math.abs(Math.sin(i * 0.5))).toFixed(2);
      rows.push(
        <line key={i} x1={x0} y1={y} x2={x1} y2={y}
          stroke="rgb(var(--acc-rgb))" strokeWidth={2} strokeLinecap="round" opacity={op} />,
      );
    }
    return rows;
  }, []);

  return (
    <>
      <div className="canvas__head">
        <span className="canvas__title">canvas</span>
        <span className="canvas__kind">idle</span>
        <span className="canvas__status">standby</span>
        <div className="canvas__tools" style={{ marginLeft: "auto" }}>
          <button className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
        </div>
      </div>
      <div className="canvas__stage">
        <div className="plate">
          <div className="plate__view">
            <svg viewBox="0 0 560 250" width="100%" style={{ display: "block" }}>{spectrum}</svg>
          </div>
          <div className="plate__cap"><b>no render yet</b><span>· a code block or artifact will dock here</span></div>
        </div>
      </div>
      <div className="canvas__foot">
        <span>waiting for a renderable object</span>
        <span className="grow" />
        <a><Ico name="bookmark" sm /> save_to_notes</a>
      </div>
    </>
  );
}

/* Read just the persisted model id (used for the header rail before a run
 * resolves the real one). Kept module-local so the render path stays sync. */
function readPrefsModel(): string {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    return typeof p.model === "string" ? p.model : "";
  } catch {
    return "";
  }
}
