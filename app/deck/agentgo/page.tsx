"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAgentGoRun } from "@/lib/agentgo";
import { InterruptDialog } from "@/components/dojo/ui/InterruptDialog";
import { ToolCallCard } from "@/components/dojo/ui/ToolCallCard";
import { ActivityCard } from "@/components/dojo/ui/ActivityCard";
import { StreamingText, MessageBubble } from "@/components/dojo/ui/StreamingText";

interface ToolCallState {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  status: "pending" | "running" | "success" | "error";
  duration?: number;
  error?: string;
}

interface StepState {
  index: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallState[];
  timestamp: string;
}

export default function AgentGoPage() {
  const [prompt, setPrompt] = useState("");
  const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
  const [mode, setMode] = useState<"AUTO" | "BUILD" | "PLAN">("AUTO");
  const [showEventLog, setShowEventLog] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingUserMessageRef = useRef<string>("");

  const {
    runId,
    status,
    events,
    assistantText,
    isTextStreaming,
    pendingInterrupt,
    isStreaming,
    start,
    approve,
    reject,
    reset: hookReset,
  } = useAgentGoRun({
    useTextStream: false, // Server doesn't have /runs/stream yet - use SSE-only mode
    onEvent: (e) => console.log("Event:", e),
    onInterrupt: (e) => console.log("Interrupt requested:", e),
    onComplete: () => console.log("Run completed"),
    onTextChunk: (chunk, fullText) => console.log("Text chunk:", chunk.length, "chars"),
    onError: (e) => console.error("Error:", e),
  });

  // Check server status on mount
  useEffect(() => {
    const checkServer = async () => {
      try {
        const res = await fetch("http://localhost:4243/health");
        if (res.ok) {
          setServerStatus("online");
        } else {
          setServerStatus("offline");
        }
      } catch {
        setServerStatus("offline");
      }
    };
    checkServer();
    const interval = setInterval(checkServer, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, messages, assistantText]);

  // Process events into UI state
  const { toolCalls, steps, userQuery } = useMemo(() => {
    const toolCallsMap = new Map<string, ToolCallState>();
    const stepsMap = new Map<number, StepState>();
    let query = "";

    for (const event of events) {
      const e = event as Record<string, unknown>;

      switch (e.type) {
        case "RunStarted": {
          const input = e.input as { data?: string } | undefined;
          if (input?.data) {
            query = String(input.data);
          }
          break;
        }

        case "ToolCallStart": {
          const id = String(e.toolCallId || "");
          const argsData = (e.args as { data?: unknown })?.data;
          toolCallsMap.set(id, {
            id,
            name: String(e.toolName || "unknown"),
            args: typeof argsData === "object" ? argsData as Record<string, unknown> : undefined,
            status: "running",
          });
          break;
        }

        case "ToolCallResult": {
          const id = String(e.toolCallId || "");
          const existing = toolCallsMap.get(id);
          const resultData = (e.result as { data?: unknown })?.data;
          if (existing) {
            existing.status = e.success ? "success" : "error";
            existing.duration = typeof e.durationMs === "number" ? e.durationMs : undefined;
            if (e.success) {
              existing.result = typeof resultData === "string" 
                ? resultData 
                : JSON.stringify(resultData, null, 2);
            } else {
              existing.error = typeof resultData === "object" && resultData !== null
                ? (resultData as { error?: string }).error || "Unknown error"
                : String(resultData);
            }
          }
          break;
        }

        case "StepStarted": {
          const idx = typeof e.stepIndex === "number" ? e.stepIndex : 0;
          stepsMap.set(idx, {
            index: idx,
            description: String(e.description || `Step ${idx}`),
            status: "in_progress",
          });
          break;
        }

        case "StepCompleted": {
          const idx = typeof e.stepIndex === "number" ? e.stepIndex : 0;
          const existing = stepsMap.get(idx);
          if (existing) {
            existing.status = "completed";
          }
          break;
        }
      }
    }

    return {
      toolCalls: Array.from(toolCallsMap.values()),
      steps: Array.from(stepsMap.values()).sort((a, b) => a.index - b.index),
      userQuery: query,
    };
  }, [events]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === "running") return;

    const userMessage = prompt.trim();
    
    // Add user message to history immediately
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    }]);
    
    pendingUserMessageRef.current = userMessage;
    setPrompt("");

    try {
      await start({
        query: userMessage,
        mode,
      });
    } catch (err) {
      console.error("Failed to start run:", err);
    }
  };
  
  // Reset both hook and messages
  const reset = () => {
    hookReset();
    setMessages([]);
  };

  // Save assistant message to history when run completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    // Check if status just changed from "running" to "completed"
    if (prevStatusRef.current === "running" && status === "completed") {
      if (assistantText) {
        setMessages(prev => {
          // Check if last message is already this assistant response
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content === assistantText) {
            return prev;
          }
          return [...prev, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantText,
            toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
            timestamp: new Date().toISOString(),
          }];
        });
      }
    }
    prevStatusRef.current = status;
  }, [status, assistantText, toolCalls]);

  const statusColor = {
    idle: "text-gray-400",
    running: "text-yellow-400",
    completed: "text-green-400",
    failed: "text-red-400",
  }[status];

  const currentStep = steps.find(s => s.status === "in_progress")?.index ?? steps.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">@</span>
          <span className="text-sm font-semibold">Agent-GO</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            serverStatus === "online" 
              ? "bg-green-500/20 text-green-400" 
              : serverStatus === "offline"
                ? "bg-red-500/20 text-red-400"
                : "bg-yellow-500/20 text-yellow-400"
          }`}>
            {serverStatus === "online" ? "Online" : serverStatus === "offline" ? "Offline" : "..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode selector */}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            disabled={status === "running"}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)]"
          >
            <option value="AUTO">AUTO</option>
            <option value="BUILD">BUILD</option>
            <option value="PLAN">PLAN</option>
          </select>
          {runId && (
            <span className="text-xs text-[var(--text-muted)] font-mono">
              {runId.slice(0, 8)}
            </span>
          )}
          <span className={`text-xs font-medium ${statusColor}`}>
            {status.toUpperCase()}
          </span>
          <button
            onClick={() => setShowEventLog(!showEventLog)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              showEventLog 
                ? "bg-[var(--accent)] text-white" 
                : "bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)]"
            }`}
          >
            Events
          </button>
          {messages.length > 0 && (
            <button
              onClick={reset}
              className="px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] transition-colors"
              title="Clear chat history"
            >
              New Chat
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat/Activity view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 && events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="text-6xl mb-4 opacity-20">@</div>
                <p className="text-lg text-[var(--text-muted)] mb-2">Agent-GO</p>
                <p className="text-sm text-[var(--text-muted)] text-center max-w-md">
                  A Go-powered AI agent with policy-controlled tool execution.
                  Enter a prompt below to start.
                </p>
                {serverStatus === "offline" && (
                  <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    Server offline. Start with: <code className="font-mono">./agentgo-server</code>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {/* Message history */}
                {messages.map((msg) => (
                  <div key={msg.id}>
                    <MessageBubble
                      content={msg.content}
                      role={msg.role}
                      timestamp={new Date(msg.timestamp).toLocaleTimeString()}
                    />
                    {/* Show tool calls for assistant messages */}
                    {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {msg.toolCalls.map((tc) => (
                          <ToolCallCard
                            key={tc.id}
                            name={tc.name}
                            args={tc.args}
                            result={tc.result}
                            status={tc.status}
                            duration={tc.duration}
                            error={tc.error}
                            isCollapsible={true}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Current run: Steps progress */}
                {status === "running" && steps.length > 0 && (
                  <ActivityCard
                    type="plan"
                    title="Execution Steps"
                    steps={steps.map(s => ({
                      id: String(s.index),
                      label: s.description,
                      status: s.status,
                    }))}
                    currentStep={currentStep}
                  />
                )}

                {/* Current run: Tool calls (only show during active run) */}
                {status === "running" && toolCalls.map((tc) => (
                  <ToolCallCard
                    key={tc.id}
                    name={tc.name}
                    args={tc.args}
                    result={tc.result}
                    status={tc.status}
                    duration={tc.duration}
                    error={tc.error}
                  />
                ))}

                {/* Current run: Streaming assistant response */}
                {status === "running" && (assistantText || isTextStreaming) && (
                  <MessageBubble
                    content={assistantText || " "}
                    role="assistant"
                  />
                )}

                {/* Streaming indicator when no text yet */}
                {status === "running" && isStreaming && !assistantText && !isTextStreaming && (
                  <StreamingText
                    content="Agent is working..."
                    isStreaming={true}
                    role="assistant"
                  />
                )}

                {/* Run result */}
                {status === "completed" && (
                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                    <div className="flex items-center gap-2 text-green-400 mb-2">
                      <span className="text-lg">&#10003;</span>
                      <span className="font-medium">Run Completed</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""} executed in {steps.length} step{steps.length !== 1 ? "s" : ""}.
                    </p>
                  </div>
                )}

                {status === "failed" && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-center gap-2 text-red-400 mb-2">
                      <span className="text-lg">&#10007;</span>
                      <span className="font-medium">Run Failed</span>
                    </div>
                    <p className="text-sm text-red-300">
                      Check the event log for details.
                    </p>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input form */}
          <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  serverStatus === "offline" 
                    ? "Server offline - start Agent-GO server first" 
                    : "What would you like the agent to do?"
                }
                disabled={serverStatus === "offline" || status === "running"}
                className="flex-1 px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={serverStatus === "offline" || status === "running" || !prompt.trim()}
                className="px-6 py-3 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {status === "running" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running
                  </span>
                ) : (
                  "Run"
                )}
              </button>
            </form>
            <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
              Mode: <span className="font-medium">{mode}</span> | 
              Port: <span className="font-mono">4243</span> |
              Workspace: current directory
            </p>
          </div>
        </div>

        {/* Event log sidebar */}
        {showEventLog && (
          <div className="w-96 border-l border-[var(--border)] flex flex-col bg-[var(--bg-secondary)]">
            <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-sm font-medium">Event Log</span>
              <span className="text-xs text-[var(--text-muted)]">
                {events.length} events
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {events.map((event, i) => (
                <EventLogItem key={i} event={event} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Interrupt dialog overlay */}
      {pendingInterrupt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <InterruptDialog
            title="Approval Required"
            description={`Tool "${pendingInterrupt.toolName}" requires your approval to execute.`}
            type="approval"
            riskLevel="medium"
            onApprove={approve}
            onReject={(reason) => reject(reason)}
          />
        </div>
      )}
    </div>
  );
}

function EventLogItem({ event, index }: { event: Record<string, unknown>; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const type = String(event.type);
  const timestamp = new Date(String(event.timestamp)).toLocaleTimeString();

  const getColor = (t: string) => {
    if (t.includes("Started") || t === "RunStarted") return "bg-blue-500/20 text-blue-400";
    if (t.includes("Completed") || t.includes("Finished")) return "bg-green-500/20 text-green-400";
    if (t.includes("Error") || t.includes("Failed")) return "bg-red-500/20 text-red-400";
    if (t.includes("Tool")) return "bg-purple-500/20 text-purple-400";
    if (t.includes("Interrupt")) return "bg-orange-500/20 text-orange-400";
    if (t.includes("Step")) return "bg-cyan-500/20 text-cyan-400";
    return "bg-zinc-500/20 text-zinc-400";
  };

  return (
    <div className="rounded-md overflow-hidden border border-[var(--border)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-2 text-left flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <span className="text-[10px] font-mono text-[var(--text-muted)] w-4">{index + 1}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${getColor(type)}`}>
          {type}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] ml-auto">{timestamp}</span>
        <svg
          className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <pre className="p-2 text-[10px] font-mono bg-[var(--bg-primary)] border-t border-[var(--border)] overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}
