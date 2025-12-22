"use client";

import { useState } from "react";
import {
  InterruptDialog,
  GenerativeForm,
  ActivityCard,
  ReasoningBubble,
  ThinkingIndicator,
  ToolCallCard,
  StreamingText,
  StateViewer,
} from "./ui";

// =============================================================================
// Demo Data
// =============================================================================

const DEMOS = [
  { id: "interrupt", title: "Approval Dialog", icon: "✋", category: "Interrupts" },
  { id: "form", title: "Generative Form", icon: "📝", category: "Generative UI" },
  { id: "activity", title: "Activity Cards", icon: "📋", category: "Activities" },
  { id: "reasoning", title: "Reasoning Bubble", icon: "🧠", category: "Reasoning" },
  { id: "tools", title: "Tool Calls", icon: "🔧", category: "Tools" },
  { id: "streaming", title: "Streaming Text", icon: "💬", category: "Messages" },
  { id: "state", title: "Shared State", icon: "🔄", category: "State" },
] as const;

type DemoId = typeof DEMOS[number]["id"];

// =============================================================================
// DojoPane Component
// =============================================================================

export function DojoPane() {
  const [selectedDemo, setSelectedDemo] = useState<DemoId>("interrupt");

  return (
    <div className="h-full flex overflow-hidden">
      {/* Sidebar - Demo Selector */}
      <div className="w-64 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <span>🥋</span>
            AG-UI Dojo
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Interactive UI Component Showcase
          </p>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              onClick={() => setSelectedDemo(demo.id)}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 flex items-center gap-2 transition-colors ${
                selectedDemo === demo.id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="text-lg">{demo.icon}</span>
              <div>
                <div className="text-sm font-medium">{demo.title}</div>
                <div className={`text-[10px] ${selectedDemo === demo.id ? "text-white/70" : "text-[var(--text-muted)]"}`}>
                  {demo.category}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
          <a
            href="https://docs.ag-ui.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--accent)]"
          >
            AG-UI Protocol Docs
          </a>
        </div>
      </div>

      {/* Main Content - Demo Stage */}
      <div className="flex-1 overflow-auto bg-[var(--bg-primary)]">
        <div className="p-8">
          {selectedDemo === "interrupt" && <InterruptDemo />}
          {selectedDemo === "form" && <FormDemo />}
          {selectedDemo === "activity" && <ActivityDemo />}
          {selectedDemo === "reasoning" && <ReasoningDemo />}
          {selectedDemo === "tools" && <ToolsDemo />}
          {selectedDemo === "streaming" && <StreamingDemo />}
          {selectedDemo === "state" && <StateDemo />}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Demo Components
// =============================================================================

function InterruptDemo() {
  const [variant, setVariant] = useState<"approval" | "input" | "confirmation">("approval");
  const [risk, setRisk] = useState<"low" | "medium" | "high" | "critical">("high");

  return (
    <div>
      <DemoHeader
        title="Approval Dialog"
        description="Human-in-the-loop interrupts for approval workflows, user input, and confirmations."
        events={["INTERRUPT_REQUEST", "INTERRUPT_RESPONSE"]}
      />

      <div className="flex gap-4 mb-6">
        <select
          value={variant}
          onChange={(e) => setVariant(e.target.value as typeof variant)}
          className="select text-sm"
        >
          <option value="approval">Approval</option>
          <option value="input">Input Required</option>
          <option value="confirmation">Confirmation</option>
        </select>
        <select
          value={risk}
          onChange={(e) => setRisk(e.target.value as typeof risk)}
          className="select text-sm"
        >
          <option value="low">Low Risk</option>
          <option value="medium">Medium Risk</option>
          <option value="high">High Risk</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <div className="space-y-4">
        <InterruptDialog
          title={
            variant === "approval" ? "Delete Production Database?" :
            variant === "input" ? "API Key Required" :
            "Confirm Email Change"
          }
          description={
            variant === "approval" ? "This action will permanently delete all data in the production database. This cannot be undone." :
            variant === "input" ? "Please provide your API key to continue with the integration." :
            "Are you sure you want to change your email to user@example.com?"
          }
          type={variant}
          riskLevel={risk}
          fields={variant === "input" ? [
            { name: "apiKey", label: "API Key", type: "text", required: true },
            { name: "environment", label: "Environment", type: "select", options: ["production", "staging", "development"] },
          ] : undefined}
          onApprove={(data) => console.log("Approved:", data)}
          onReject={(reason) => console.log("Rejected:", reason)}
        />
      </div>
    </div>
  );
}

function FormDemo() {
  const [formType, setFormType] = useState<"booking" | "contact" | "settings">("booking");

  const schemas = {
    booking: {
      type: "object" as const,
      title: "Book a Flight",
      description: "Enter your travel details",
      properties: {
        from: { type: "string" as const, title: "From", description: "Departure city" },
        to: { type: "string" as const, title: "To", description: "Destination city" },
        date: { type: "string" as const, title: "Date", format: "date" as const },
        passengers: { type: "number" as const, title: "Passengers", minimum: 1, maximum: 9 },
        class: { type: "string" as const, title: "Class", enum: ["Economy", "Business", "First"] },
      },
      required: ["from", "to", "date"],
    },
    contact: {
      type: "object" as const,
      title: "Contact Information",
      description: "How can we reach you?",
      properties: {
        name: { type: "string" as const, title: "Full Name" },
        email: { type: "string" as const, title: "Email", format: "email" as const },
        phone: { type: "string" as const, title: "Phone" },
        message: { type: "string" as const, title: "Message", description: "Your inquiry" },
      },
      required: ["name", "email"],
    },
    settings: {
      type: "object" as const,
      title: "Preferences",
      description: "Customize your experience",
      properties: {
        notifications: { type: "boolean" as const, title: "Enable Notifications", default: true },
        theme: { type: "string" as const, title: "Theme", enum: ["Light", "Dark", "System"] },
        language: { type: "string" as const, title: "Language", enum: ["English", "Spanish", "French", "German"] },
      },
    },
  };

  return (
    <div>
      <DemoHeader
        title="Generative Form"
        description="AI-generated forms from JSON Schema with validation and dynamic rendering."
        events={["GENERATIVE_UI_FORM", "STATE_DELTA"]}
      />

      <div className="flex gap-4 mb-6">
        <select
          value={formType}
          onChange={(e) => setFormType(e.target.value as typeof formType)}
          className="select text-sm"
        >
          <option value="booking">Flight Booking</option>
          <option value="contact">Contact Form</option>
          <option value="settings">Settings</option>
        </select>
      </div>

      <GenerativeForm
        schema={schemas[formType]}
        onSubmit={(data) => console.log("Form submitted:", data)}
      />
    </div>
  );
}

function ActivityDemo() {
  const [activityType, setActivityType] = useState<"plan" | "progress" | "checklist" | "search">("plan");

  return (
    <div>
      <DemoHeader
        title="Activity Cards"
        description="Visual feedback for agent activities: plans, progress, checklists, and searches."
        events={["ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA"]}
      />

      <div className="flex gap-4 mb-6">
        <select
          value={activityType}
          onChange={(e) => setActivityType(e.target.value as typeof activityType)}
          className="select text-sm"
        >
          <option value="plan">Plan</option>
          <option value="progress">Progress</option>
          <option value="checklist">Checklist</option>
          <option value="search">Search</option>
        </select>
      </div>

      <div className="space-y-4">
        {activityType === "plan" && (
          <ActivityCard
            type="plan"
            title="Research Task Plan"
            steps={[
              { id: "1", label: "Search for relevant papers", status: "completed" },
              { id: "2", label: "Analyze key findings", status: "in_progress" },
              { id: "3", label: "Synthesize information", status: "pending" },
              { id: "4", label: "Generate summary", status: "pending" },
            ]}
            currentStep={1}
          />
        )}

        {activityType === "progress" && (
          <ActivityCard
            type="progress"
            title="Processing Documents"
            current={67}
            total={100}
            message="Analyzing document 67 of 100..."
          />
        )}

        {activityType === "checklist" && (
          <ActivityCard
            type="checklist"
            title="Setup Checklist"
            items={[
              { id: "1", label: "Install dependencies", checked: true },
              { id: "2", label: "Configure environment", checked: true },
              { id: "3", label: "Run migrations", checked: false },
              { id: "4", label: "Start server", checked: false },
            ]}
            onItemToggle={(id, checked) => console.log("Toggle:", id, checked)}
          />
        )}

        {activityType === "search" && (
          <ActivityCard
            type="search"
            title="Web Search"
            query="latest advances in quantum computing"
            results={[
              { title: "Quantum Computing Breakthrough 2024", snippet: "Researchers achieve new milestone in quantum error correction..." },
              { title: "IBM Quantum Roadmap", snippet: "IBM announces plans for 100,000 qubit processor by 2033..." },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ReasoningDemo() {
  const [isStreaming, setIsStreaming] = useState(false);

  return (
    <div>
      <DemoHeader
        title="Reasoning Bubble"
        description="Chain-of-thought visibility showing the agent's thinking process."
        events={["REASONING_START", "REASONING_MESSAGE_CONTENT", "REASONING_END"]}
      />

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setIsStreaming(!isStreaming)}
          className={`btn ${isStreaming ? "btn-secondary" : "btn-primary"}`}
        >
          {isStreaming ? "Stop Streaming" : "Simulate Streaming"}
        </button>
      </div>

      <div className="space-y-4">
        <ThinkingIndicator message="Analyzing the problem..." />

        <ReasoningBubble
          content="Let me think about this step by step. First, I need to understand the problem constraints. The user is asking about quantum computing advances, which involves several key areas: hardware improvements, error correction, and algorithmic developments. I should search for recent papers and news articles to provide an accurate, up-to-date response."
          isStreaming={isStreaming}
        />

        <ReasoningBubble
          content="Based on my analysis, I've identified three main areas of progress: 1) Error correction codes have improved significantly, 2) Qubit coherence times have increased, and 3) New quantum algorithms have been developed for practical applications."
          isCollapsed={true}
        />
      </div>
    </div>
  );
}

function ToolsDemo() {
  return (
    <div>
      <DemoHeader
        title="Tool Calls"
        description="Visual representation of tool/function calls with arguments and results."
        events={["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT"]}
      />

      <div className="space-y-4">
        <ToolCallCard
          name="web_search"
          args={{ query: "quantum computing 2024", limit: 5 }}
          status="success"
          result="Found 5 relevant articles about quantum computing advances in 2024."
          duration={1234}
        />

        <ToolCallCard
          name="analyze_document"
          args={{ url: "https://arxiv.org/paper/123", extract: ["abstract", "conclusions"] }}
          status="running"
        />

        <ToolCallCard
          name="send_email"
          args={{ to: "team@example.com", subject: "Weekly Report" }}
          status="error"
          error="SMTP connection failed: timeout after 30 seconds"
          duration={30000}
        />

        <ToolCallCard
          name="generate_chart"
          args={{ type: "bar", data: [10, 20, 30, 40] }}
          status="pending"
        />
      </div>
    </div>
  );
}

function StreamingDemo() {
  return (
    <div>
      <DemoHeader
        title="Streaming Text"
        description="Token-by-token text streaming for real-time message display."
        events={["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]}
      />

      <div className="space-y-4 max-w-2xl">
        <StreamingText
          content="Tell me about quantum computing"
          role="user"
        />

        <StreamingText
          content="Quantum computing is a revolutionary computing paradigm that leverages quantum mechanical phenomena like superposition and entanglement to process information. Unlike classical computers that use bits (0 or 1), quantum computers use qubits that can exist in multiple states simultaneously..."
          role="assistant"
          isStreaming={true}
        />
      </div>
    </div>
  );
}

function StateDemo() {
  const [counter, setCounter] = useState(0);
  const [patches, setPatches] = useState<Array<{ op: string; path: string; value?: unknown }>>([]);

  const state = {
    counter,
    user: {
      name: "Alice",
      role: "admin",
    },
    items: ["Task 1", "Task 2", "Task 3"],
    settings: {
      theme: "dark",
      notifications: true,
    },
  };

  const handleIncrement = () => {
    setCounter((c) => c + 1);
    setPatches((p) => [...p, { op: "replace", path: "/counter", value: counter + 1 }]);
  };

  const handleAddItem = () => {
    setPatches((p) => [...p, { op: "add", path: "/items/-", value: `Task ${state.items.length + 1}` }]);
  };

  return (
    <div>
      <DemoHeader
        title="Shared State"
        description="Real-time state synchronization using JSON Patch (RFC 6902)."
        events={["STATE_SNAPSHOT", "STATE_DELTA"]}
      />

      <div className="flex gap-4 mb-6">
        <button onClick={handleIncrement} className="btn btn-primary">
          Increment Counter
        </button>
        <button onClick={handleAddItem} className="btn btn-secondary">
          Add Item
        </button>
        <button onClick={() => setPatches([])} className="btn btn-ghost">
          Clear Patches
        </button>
      </div>

      <StateViewer state={state} patches={patches} />
    </div>
  );
}

// =============================================================================
// Demo Header Component
// =============================================================================

function DemoHeader({
  title,
  description,
  events,
}: {
  title: string;
  description: string;
  events: string[];
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{title}</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-4">{description}</p>
      <div className="flex flex-wrap gap-2">
        {events.map((event) => (
          <span
            key={event}
            className="px-2 py-1 text-[10px] font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-[var(--text-muted)]"
          >
            {event}
          </span>
        ))}
      </div>
    </div>
  );
}
