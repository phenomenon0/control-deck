"use client";

import { useState, useMemo } from "react";
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

const DEMOS = [
  { id: "interrupt", title: "Approval Dialog", category: "Interrupts", description: "Human checkpoints, risk labels, and explicit consent." },
  { id: "form", title: "Generative Form", category: "Generative UI", description: "Schema-backed forms that arrive as agent output." },
  { id: "activity", title: "Activity Cards", category: "Activities", description: "Plans, progress, checklists, and search status." },
  { id: "reasoning", title: "Reasoning Bubble", category: "Reasoning", description: "Collapsible thinking traces and active analysis." },
  { id: "tools", title: "Tool Calls", category: "Tools", description: "Arguments, result states, timing, and errors." },
  { id: "streaming", title: "Streaming Text", category: "Messages", description: "Token-by-token message surfaces." },
  { id: "state", title: "Shared State", category: "State", description: "JSON Patch updates and synchronized state." },
  { id: "soccer_scout", title: "Scout Report", category: "Composite", description: "A full specimen with forms, activity, and state." },
] as const;

type DemoId = typeof DEMOS[number]["id"];

export function DojoPane() {
  const [selectedDemo, setSelectedDemo] = useState<DemoId>("interrupt");
  const selectedMeta = DEMOS.find((demo) => demo.id === selectedDemo) ?? DEMOS[0];
  const groupedDemos = useMemo(() => {
    const groups = new Map<string, typeof DEMOS[number][]>();
    for (const demo of DEMOS) {
      const current = groups.get(demo.category) ?? [];
      current.push(demo);
      groups.set(demo.category, current);
    }
    return Array.from(groups.entries());
  }, []);

  return (
    <div className="dojo-stage">
      <header className="dojo-head">
        <div className="label">Component Field Manual · {DEMOS.length} specimens</div>
        <h1>The parts, dissected.</h1>
        <p>Interaction specimens for agent events, state changes, approvals, and generated UI.</p>
      </header>

      <div className="dojo-split">
        <aside className="dojo-index">
          {groupedDemos.map(([category, demos]) => (
            <div key={category} className="dojo-idx-group">
              <div className="label">{category}</div>
              {demos.map((demo) => (
                <button
                  key={demo.id}
                  onClick={() => setSelectedDemo(demo.id)}
                  className={`dojo-idx ${selectedDemo === demo.id ? "on" : ""}`}
                >
                  <span>{demo.title}</span>
                  <span className="dojo-idx-id">{demo.description}</span>
                </button>
              ))}
            </div>
          ))}

          <div className="dojo-note-row">
            <a
              href="https://docs.ag-ui.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Protocol docs
            </a>
          </div>
        </aside>

      {/* Main Content - Demo Stage */}
      <main className="dojo-main" aria-label={`${selectedMeta.title} specimen`}>
          {selectedDemo === "interrupt" && <InterruptDemo />}
          {selectedDemo === "form" && <FormDemo />}
          {selectedDemo === "activity" && <ActivityDemo />}
          {selectedDemo === "reasoning" && <ReasoningDemo />}
          {selectedDemo === "tools" && <ToolsDemo />}
          {selectedDemo === "streaming" && <StreamingDemo />}
          {selectedDemo === "state" && <StateDemo />}
          {selectedDemo === "soccer_scout" && <SoccerScoutDemo />}
      </main>
      </div>
    </div>
  );
}

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

  const schemas = useMemo(() => ({
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
  }), []);

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

function SoccerScoutDemo() {
  const [currentStep, setCurrentStep] = useState(0);
  
  const scoutFormSchema = useMemo(() => ({
    type: "object" as const,
    title: "Scout Notes",
    description: "Add your personal observations",
    properties: {
      watchedLive: { type: "boolean" as const, title: "Watched Live?" },
      opposition: { type: "string" as const, title: "Opposition Team" },
      personalNotes: { type: "string" as const, title: "Personal Notes" },
      recommendedFee: { type: "string" as const, title: "Recommended Fee" },
      priority: { type: "string" as const, title: "Signing Priority", enum: ["High", "Medium", "Low"] },
    },
  }), []);

  const [scoutState, setScoutState] = useState({
    player: {
      name: "Marcus Rashford",
      age: 26,
      position: "Left Wing / Striker",
      currentClub: "Manchester United",
      nationality: "England",
      marketValue: "€55M",
    },
    physicalAttributes: {
      height: "180 cm",
      weight: "70 kg",
      preferredFoot: "Right",
      pace: 89,
      stamina: 82,
      strength: 71,
    },
    technicalSkills: {
      passing: 78,
      shooting: 84,
      dribbling: 86,
      firstTouch: 83,
      crossing: 76,
      heading: 72,
    },
    mentalAttributes: {
      vision: 77,
      composure: 74,
      leadership: 72,
      workRate: 85,
      positioning: 81,
    },
    matchStats: {
      appearances: 38,
      goals: 17,
      assists: 6,
      minutesPlayed: 3124,
    },
    recommendation: "sign" as const,
    overallRating: 82,
  });

  const steps = [
    { id: "1", label: "Gathering player data", status: currentStep > 0 ? "completed" : currentStep === 0 ? "in_progress" : "pending" },
    { id: "2", label: "Analyzing physical attributes", status: currentStep > 1 ? "completed" : currentStep === 1 ? "in_progress" : "pending" },
    { id: "3", label: "Evaluating technical skills", status: currentStep > 2 ? "completed" : currentStep === 2 ? "in_progress" : "pending" },
    { id: "4", label: "Assessing mental attributes", status: currentStep > 3 ? "completed" : currentStep === 3 ? "in_progress" : "pending" },
    { id: "5", label: "Compiling match statistics", status: currentStep > 4 ? "completed" : currentStep === 4 ? "in_progress" : "pending" },
    { id: "6", label: "Generating recommendation", status: currentStep > 5 ? "completed" : currentStep === 5 ? "in_progress" : "pending" },
  ] as const;

  const advanceStep = () => {
    setCurrentStep((s) => Math.min(s + 1, 6));
  };

  const resetDemo = () => {
    setCurrentStep(0);
  };

  const AttributeBar = ({ label, value, max = 100 }: { label: string; value: number; max?: number }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-[var(--fg-dim)]">{label}</span>
      <div className="flex-1 h-2 bg-[var(--bg)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[var(--fg)]">{value}</span>
    </div>
  );

  return (
    <div>
      <DemoHeader
        title="Soccer Scout Report"
        description="Progressive player analysis with real-time state updates. Demonstrates shared state with activity tracking."
        events={["STATE_SNAPSHOT", "STATE_DELTA", "ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA", "GENERATIVE_UI_FORM"]}
      />

      <div className="flex gap-4 mb-6">
        <button onClick={advanceStep} disabled={currentStep >= 6} className="btn btn-primary">
          {currentStep >= 6 ? "Complete" : "Next Step"}
        </button>
        <button onClick={resetDemo} className="btn btn-secondary">
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Card - Scouting Progress */}
        <ActivityCard
          type="plan"
          title={`Scouting: ${scoutState.player.name}`}
          steps={steps.map(s => ({ ...s, status: s.status as "pending" | "in_progress" | "completed" | "failed" }))}
          currentStep={currentStep}
        />

        {/* Player Info Card */}
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-[#0a0a0a] font-bold text-lg"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-deep))" }}
            >
              {scoutState.player.name.split(" ").map(n => n[0]).join("")}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--fg)]">{scoutState.player.name}</h3>
              <p className="text-xs text-[var(--fg-dim)]">{scoutState.player.position}</p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-bold text-[var(--accent)]">{scoutState.overallRating}</div>
              <div className="text-[10px] text-[var(--fg-dim)]">Overall</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center p-2 bg-[var(--bg)] rounded">
              <div className="text-[var(--fg-dim)]">Age</div>
              <div className="font-semibold text-[var(--fg)]">{scoutState.player.age}</div>
            </div>
            <div className="text-center p-2 bg-[var(--bg)] rounded">
              <div className="text-[var(--fg-dim)]">Club</div>
              <div className="font-semibold text-[var(--fg)] truncate">{scoutState.player.currentClub}</div>
            </div>
            <div className="text-center p-2 bg-[var(--bg)] rounded">
              <div className="text-[var(--fg-dim)]">Value</div>
              <div className="font-semibold text-[var(--fg)]">{scoutState.player.marketValue}</div>
            </div>
          </div>
        </div>

        {/* Physical Attributes */}
        {currentStep >= 2 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
            <h4 className="text-sm font-semibold text-[var(--fg)] mb-3 flex items-center gap-2">
              <span>💪</span> Physical Attributes
            </h4>
            <div className="space-y-2">
              <AttributeBar label="Pace" value={scoutState.physicalAttributes.pace} />
              <AttributeBar label="Stamina" value={scoutState.physicalAttributes.stamina} />
              <AttributeBar label="Strength" value={scoutState.physicalAttributes.strength} />
            </div>
          </div>
        )}

        {/* Technical Skills */}
        {currentStep >= 3 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
            <h4 className="text-sm font-semibold text-[var(--fg)] mb-3 flex items-center gap-2">
              <span>⚽</span> Technical Skills
            </h4>
            <div className="space-y-2">
              <AttributeBar label="Dribbling" value={scoutState.technicalSkills.dribbling} />
              <AttributeBar label="Shooting" value={scoutState.technicalSkills.shooting} />
              <AttributeBar label="Passing" value={scoutState.technicalSkills.passing} />
              <AttributeBar label="First Touch" value={scoutState.technicalSkills.firstTouch} />
            </div>
          </div>
        )}

        {/* Mental Attributes */}
        {currentStep >= 4 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
            <h4 className="text-sm font-semibold text-[var(--fg)] mb-3 flex items-center gap-2">
              <span>🧠</span> Mental Attributes
            </h4>
            <div className="space-y-2">
              <AttributeBar label="Work Rate" value={scoutState.mentalAttributes.workRate} />
              <AttributeBar label="Positioning" value={scoutState.mentalAttributes.positioning} />
              <AttributeBar label="Vision" value={scoutState.mentalAttributes.vision} />
              <AttributeBar label="Composure" value={scoutState.mentalAttributes.composure} />
            </div>
          </div>
        )}

        {/* Match Stats */}
        {currentStep >= 5 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
            <h4 className="text-sm font-semibold text-[var(--fg)] mb-3 flex items-center gap-2">
              <span>📊</span> Season Statistics
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 bg-[var(--bg)] rounded">
                <div className="text-2xl font-bold text-[var(--fg)]">{scoutState.matchStats.appearances}</div>
                <div className="text-xs text-[var(--fg-dim)]">Appearances</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg)] rounded">
                <div className="text-2xl font-bold text-green-400">{scoutState.matchStats.goals}</div>
                <div className="text-xs text-[var(--fg-dim)]">Goals</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg)] rounded">
                <div className="text-2xl font-bold text-blue-400">{scoutState.matchStats.assists}</div>
                <div className="text-xs text-[var(--fg-dim)]">Assists</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg)] rounded">
                <div className="text-2xl font-bold text-[var(--fg)]">{scoutState.matchStats.minutesPlayed}</div>
                <div className="text-xs text-[var(--fg-dim)]">Minutes</div>
              </div>
            </div>
          </div>
        )}

        {/* Final Recommendation */}
        {currentStep >= 6 && (
          <div className="rounded-[6px] border border-[var(--success)] bg-[var(--bg-elev)] p-4 lg:col-span-2">
            <h4 className="text-sm font-semibold text-[var(--success)] mb-2 flex items-center gap-2">
              <span>✅</span> Scout Recommendation
            </h4>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-[var(--fg)]">SIGN</p>
                <p className="text-xs text-[var(--fg-muted)]">
                  Explosive pace, excellent dribbling, high work rate. Good fit for attacking system.
                </p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400">{scoutState.overallRating}</div>
                <div className="text-xs text-[var(--fg-dim)]">Rating</div>
              </div>
            </div>
          </div>
        )}

        {/* Scout Input Form */}
        {currentStep >= 6 && (
          <div className="lg:col-span-2">
            <GenerativeForm
              schema={scoutFormSchema}
              onSubmit={(data) => console.log("Scout notes submitted:", data)}
            />
          </div>
        )}
      </div>
    </div>
  );
}


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
    <div className="dojo-plate-head animate-fade-in">
      <div>
        <div className="label">Specimen</div>
        <h2>{title}</h2>
        <p className="dojo-desc">{description}</p>
      </div>
      <div className="dojo-plate-meta">
        {events.map((event) => (
          <span
            key={event}
            className="pill--mono"
          >
            {event}
          </span>
        ))}
      </div>
    </div>
  );
}
