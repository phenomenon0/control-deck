"use client";

import { useState } from "react";

// =============================================================================
// Types
// =============================================================================

export interface DemoInfo {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "core" | "showcase";
  events: string[];
  model?: string;
}

interface DemoCardProps {
  demo: DemoInfo;
  isActive: boolean;
  isRunning: boolean;
  onRun: () => void;
}

// =============================================================================
// Demo Code Snippets
// =============================================================================

const DEMO_CODE: Record<string, string> = {
  shared_state: `// Shared State with JSON Patch
const { state, patchState } = useAgui({ threadId: "demo" });

// Server sends STATE_SNAPSHOT
emit({ type: "STATE_SNAPSHOT", snapshot: { count: 0, items: [] } });

// Then sends STATE_DELTA with JSON Patch ops
emit({
  type: "STATE_DELTA",
  delta: [
    { op: "replace", path: "/count", value: 1 },
    { op: "add", path: "/items/-", value: "new item" }
  ]
});`,

  tool_calling: `// Tool Calling Protocol
emit({ type: "TOOL_CALL_START", toolCallId: "tc_1", name: "search" });

// Stream arguments
emit({ type: "TOOL_CALL_ARGS", toolCallId: "tc_1", delta: '{"query":' });
emit({ type: "TOOL_CALL_ARGS", toolCallId: "tc_1", delta: '"weather"}' });

// Complete with result
emit({
  type: "TOOL_CALL_END",
  toolCallId: "tc_1",
  result: "Sunny, 72°F"
});`,

  activity: `// Activity Messages
emit({
  type: "ACTIVITY_PLAN",
  activityId: "plan_1",
  title: "Research Plan",
  steps: ["Search", "Analyze", "Synthesize"]
});

emit({
  type: "ACTIVITY_PROGRESS",
  activityId: "prog_1",
  title: "Processing",
  current: 2,
  total: 5
});`,

  reasoning: `// Reasoning Events (Chain-of-Thought)
emit({ type: "REASONING_START", reasoningId: "r_1" });

emit({
  type: "REASONING_CONTENT",
  reasoningId: "r_1",
  delta: "Let me think about this..."
});

emit({ type: "REASONING_END", reasoningId: "r_1" });`,

  interrupt: `// Human-in-the-Loop Approval
emit({
  type: "INTERRUPT_REQUEST",
  interruptId: "int_1",
  title: "Delete File?",
  description: "Confirm deletion of important.txt",
  interruptType: "approval",
  schema: { type: "object", properties: { confirm: { type: "boolean" } } }
});

// User responds...
emit({
  type: "INTERRUPT_RESPONSE",
  interruptId: "int_1",
  approved: true,
  data: { confirm: true }
});`,

  generative_ui: `// Generative UI - Dynamic Forms
emit({
  type: "GENERATIVE_UI_FORM",
  formId: "form_1",
  title: "Book a Flight",
  schema: {
    type: "object",
    properties: {
      from: { type: "string", title: "From" },
      to: { type: "string", title: "To" },
      date: { type: "string", format: "date" }
    },
    required: ["from", "to", "date"]
  },
  uiSchema: { from: { "ui:placeholder": "Origin city" } }
});`,

  meta_events: `// Meta Events for Feedback
emit({
  type: "META_THUMBS_UP",
  messageId: "msg_1",
  timestamp: Date.now()
});

emit({
  type: "META_TAG",
  messageId: "msg_1",
  tag: "helpful",
  action: "add"
});`,

  multimodal: `// Multimodal Messages
emit({
  type: "TEXT_MESSAGE_START",
  messageId: "msg_1",
  role: "assistant"
});

emit({
  type: "TEXT_MESSAGE_CONTENT",
  messageId: "msg_1",
  delta: "Here's an analysis of your image:\\n",
  attachments: [{ type: "image", url: "data:image/..." }]
});`,

  poetry: `// Real Ollama Streaming
const response = await fetch("/api/dojo/demo", {
  method: "POST",
  body: JSON.stringify({
    threadId: "poetry",
    demo: "poetry",
    model: "llama3.2",
    input: "Write a haiku about coding"
  })
});

// Events stream via SSE at /api/dojo/stream`,

  travel: `// Multi-step Trip Planner
// 1. Shows activity plan
// 2. Generates preference form
// 3. Calls search tools
// 4. Presents itinerary

POST /api/dojo/demo
{ demo: "travel", input: "Plan a trip to Tokyo" }`,

  research: `// Research with Visible Reasoning
// 1. REASONING_* shows thinking
// 2. TOOL_CALL_* for searches
// 3. ACTIVITY_* for progress
// 4. Final synthesis

POST /api/dojo/demo
{ demo: "research", input: "What is quantum computing?" }`,

  approval: `// Approval Workflow
// Agent wants to perform sensitive action
// Pauses and requests human approval
// Continues or aborts based on response

emit({
  type: "INTERRUPT_REQUEST",
  interruptType: "approval",
  title: "Transfer $500?",
  description: "Confirm bank transfer"
});`,

  form: `// Dynamic Form Generation
// AI analyzes context
// Generates appropriate form schema
// Form updates state on submit

emit({
  type: "GENERATIVE_UI_FORM",
  formId: "contact",
  title: "Contact Info",
  schema: { /* generated based on context */ }
});`,
};

// =============================================================================
// DemoCard Component
// =============================================================================

export function DemoCard({ demo, isActive, isRunning, onRun }: DemoCardProps) {
  const [showCode, setShowCode] = useState(false);

  return (
    <div
      className={`card transition-all duration-200 ${
        isActive
          ? "border-[var(--accent)] bg-[var(--bg-tertiary)]"
          : "hover:border-[var(--border-bright)]"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <span className="text-2xl">{demo.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {demo.title}
          </h4>
          <p className="text-xs text-[var(--text-muted)] line-clamp-2">
            {demo.description}
          </p>
        </div>
      </div>

      {/* Event Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {demo.events.slice(0, 3).map((event) => (
          <span
            key={event}
            className="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-muted)]"
          >
            {event}
          </span>
        ))}
        {demo.events.length > 3 && (
          <span className="px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            +{demo.events.length - 3}
          </span>
        )}
      </div>

      {/* Model Badge (for showcase demos) */}
      {demo.model && (
        <div className="mb-3">
          <span className="badge badge-info text-[10px]">
            Ollama: {demo.model}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRun}
          disabled={isRunning}
          className={`btn flex-1 text-xs ${
            isRunning ? "btn-secondary" : "btn-primary"
          }`}
        >
          {isRunning ? (
            <>
              <span className="tool-spinner mr-2" />
              Running...
            </>
          ) : (
            <>
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Run
            </>
          )}
        </button>
        <button
          onClick={() => setShowCode(!showCode)}
          className="btn btn-ghost text-xs"
          title="View Code"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        </button>
      </div>

      {/* Code Preview */}
      {showCode && (
        <div className="mt-3 animate-fade-in">
          <pre className="text-[10px] p-2 bg-[var(--bg-primary)] rounded border border-[var(--border)] overflow-x-auto max-h-48">
            <code className="text-[var(--text-secondary)]">
              {DEMO_CODE[demo.id] || "// Code not available"}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
