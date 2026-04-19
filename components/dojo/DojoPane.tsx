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
  { id: "interrupt", title: "Approval Dialog", icon: "✋", category: "Interrupts" },
  { id: "form", title: "Generative Form", icon: "📝", category: "Generative UI" },
  { id: "activity", title: "Activity Cards", icon: "📋", category: "Activities" },
  { id: "reasoning", title: "Reasoning Bubble", icon: "🧠", category: "Reasoning" },
  { id: "tools", title: "Tool Calls", icon: "🔧", category: "Tools" },
  { id: "streaming", title: "Streaming Text", icon: "💬", category: "Messages" },
  { id: "state", title: "Shared State", icon: "🔄", category: "State" },
  { id: "soccer_scout", title: "Soccer Scout", icon: "⚽", category: "Showcase" },
  { id: "horoscope", title: "Horoscope", icon: "🔮", category: "Showcase" },
] as const;

type DemoId = typeof DEMOS[number]["id"];

export function DojoPane() {
  const [selectedDemo, setSelectedDemo] = useState<DemoId>("interrupt");

  return (
    <div className="dojo-stage">
      <header className="dojo-head">
        <div className="label">AG-UI</div>
        <h1>Dojo</h1>
        <p>Protocol components and live interaction specimens for agent UI events.</p>
      </header>

      <div className="dojo-split">
        <aside className="dojo-index">
          <div className="dojo-idx-group">
            <div className="label">Specimens</div>
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              onClick={() => setSelectedDemo(demo.id)}
              className={`dojo-idx ${selectedDemo === demo.id ? "on" : ""}`}
            >
              <span>{demo.title}</span>
              <span className="dojo-idx-id">{demo.category}</span>
            </button>
          ))}
          </div>

        <div className="pt-3 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
          <a
            href="https://docs.ag-ui.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--accent)] transition-colors"
          >
            AG-UI Protocol Docs
          </a>
        </div>
        </aside>

      {/* Main Content - Demo Stage */}
      <main className="dojo-main">
          {selectedDemo === "interrupt" && <InterruptDemo />}
          {selectedDemo === "form" && <FormDemo />}
          {selectedDemo === "activity" && <ActivityDemo />}
          {selectedDemo === "reasoning" && <ReasoningDemo />}
          {selectedDemo === "tools" && <ToolsDemo />}
          {selectedDemo === "streaming" && <StreamingDemo />}
          {selectedDemo === "state" && <StateDemo />}
          {selectedDemo === "soccer_scout" && <SoccerScoutDemo />}
          {selectedDemo === "horoscope" && <HoroscopeDemo />}
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
      <span className="w-20 text-[var(--text-muted)]">{label}</span>
      <div className="flex-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[var(--text-primary)]">{value}</span>
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
        <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-white font-bold text-lg">
              {scoutState.player.name.split(" ").map(n => n[0]).join("")}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{scoutState.player.name}</h3>
              <p className="text-xs text-[var(--text-muted)]">{scoutState.player.position}</p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-bold text-[var(--accent)]">{scoutState.overallRating}</div>
              <div className="text-[10px] text-[var(--text-muted)]">Overall</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center p-2 bg-[var(--bg-primary)] rounded">
              <div className="text-[var(--text-muted)]">Age</div>
              <div className="font-semibold text-[var(--text-primary)]">{scoutState.player.age}</div>
            </div>
            <div className="text-center p-2 bg-[var(--bg-primary)] rounded">
              <div className="text-[var(--text-muted)]">Club</div>
              <div className="font-semibold text-[var(--text-primary)] truncate">{scoutState.player.currentClub}</div>
            </div>
            <div className="text-center p-2 bg-[var(--bg-primary)] rounded">
              <div className="text-[var(--text-muted)]">Value</div>
              <div className="font-semibold text-[var(--text-primary)]">{scoutState.player.marketValue}</div>
            </div>
          </div>
        </div>

        {/* Physical Attributes */}
        {currentStep >= 2 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
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
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
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
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
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
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span>📊</span> Season Statistics
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 bg-[var(--bg-primary)] rounded">
                <div className="text-2xl font-bold text-[var(--text-primary)]">{scoutState.matchStats.appearances}</div>
                <div className="text-xs text-[var(--text-muted)]">Appearances</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg-primary)] rounded">
                <div className="text-2xl font-bold text-green-400">{scoutState.matchStats.goals}</div>
                <div className="text-xs text-[var(--text-muted)]">Goals</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg-primary)] rounded">
                <div className="text-2xl font-bold text-blue-400">{scoutState.matchStats.assists}</div>
                <div className="text-xs text-[var(--text-muted)]">Assists</div>
              </div>
              <div className="text-center p-3 bg-[var(--bg-primary)] rounded">
                <div className="text-2xl font-bold text-[var(--text-primary)]">{scoutState.matchStats.minutesPlayed}</div>
                <div className="text-xs text-[var(--text-muted)]">Minutes</div>
              </div>
            </div>
          </div>
        )}

        {/* Final Recommendation */}
        {currentStep >= 6 && (
          <div className="rounded-[6px] border border-[var(--success)] bg-[rgba(255,255,255,0.02)] p-4 lg:col-span-2">
            <h4 className="text-sm font-semibold text-[var(--success)] mb-2 flex items-center gap-2">
              <span>✅</span> Scout Recommendation
            </h4>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">SIGN</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Explosive pace, excellent dribbling, high work rate. Good fit for attacking system.
                </p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-400">{scoutState.overallRating}</div>
                <div className="text-xs text-[var(--text-muted)]">Rating</div>
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

function HoroscopeDemo() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedSign, setSelectedSign] = useState("cancer");
  const [isStreaming, setIsStreaming] = useState(false);

  const horoscopeFormSchema = useMemo(() => ({
    type: "object" as const,
    title: "Your Cosmic Profile",
    description: "Enter your birth details for a personalized reading",
    properties: {
      name: { type: "string" as const, title: "Your Name" },
      birthDate: { type: "string" as const, title: "Birth Date", format: "date" as const },
      birthTime: { type: "string" as const, title: "Birth Time (optional)" },
      birthPlace: { type: "string" as const, title: "Birth Place (optional)" },
      focusArea: { type: "string" as const, title: "Focus Area", enum: ["Love", "Career", "Health", "Personal Growth"] },
    },
    required: ["name", "birthDate"],
  }), []);

  const ZODIAC_DATA: Record<string, { symbol: string; element: string; planet: string; dates: string; traits: string[]; compatible: string[] }> = {
    aries: { symbol: "♈", element: "Fire", planet: "Mars", dates: "Mar 21 - Apr 19", traits: ["Courageous", "Confident", "Enthusiastic"], compatible: ["Leo", "Sagittarius"] },
    taurus: { symbol: "♉", element: "Earth", planet: "Venus", dates: "Apr 20 - May 20", traits: ["Reliable", "Patient", "Devoted"], compatible: ["Virgo", "Capricorn"] },
    gemini: { symbol: "♊", element: "Air", planet: "Mercury", dates: "May 21 - Jun 20", traits: ["Adaptable", "Curious", "Quick-witted"], compatible: ["Libra", "Aquarius"] },
    cancer: { symbol: "♋", element: "Water", planet: "Moon", dates: "Jun 21 - Jul 22", traits: ["Loyal", "Protective", "Intuitive"], compatible: ["Scorpio", "Pisces"] },
    leo: { symbol: "♌", element: "Fire", planet: "Sun", dates: "Jul 23 - Aug 22", traits: ["Creative", "Passionate", "Generous"], compatible: ["Aries", "Sagittarius"] },
    virgo: { symbol: "♍", element: "Earth", planet: "Mercury", dates: "Aug 23 - Sep 22", traits: ["Analytical", "Practical", "Diligent"], compatible: ["Taurus", "Capricorn"] },
    libra: { symbol: "♎", element: "Air", planet: "Venus", dates: "Sep 23 - Oct 22", traits: ["Diplomatic", "Fair-minded", "Social"], compatible: ["Gemini", "Aquarius"] },
    scorpio: { symbol: "♏", element: "Water", planet: "Pluto", dates: "Oct 23 - Nov 21", traits: ["Resourceful", "Brave", "Passionate"], compatible: ["Cancer", "Pisces"] },
    sagittarius: { symbol: "♐", element: "Fire", planet: "Jupiter", dates: "Nov 22 - Dec 21", traits: ["Generous", "Idealistic", "Adventurous"], compatible: ["Aries", "Leo"] },
    capricorn: { symbol: "♑", element: "Earth", planet: "Saturn", dates: "Dec 22 - Jan 19", traits: ["Responsible", "Disciplined", "Ambitious"], compatible: ["Taurus", "Virgo"] },
    aquarius: { symbol: "♒", element: "Air", planet: "Uranus", dates: "Jan 20 - Feb 18", traits: ["Progressive", "Original", "Independent"], compatible: ["Gemini", "Libra"] },
    pisces: { symbol: "♓", element: "Water", planet: "Neptune", dates: "Feb 19 - Mar 20", traits: ["Compassionate", "Artistic", "Intuitive"], compatible: ["Cancer", "Scorpio"] },
  };

  const sign = ZODIAC_DATA[selectedSign];
  const elementColors: Record<string, string> = {
    Fire: "from-orange-500 to-red-500",
    Earth: "from-green-600 to-emerald-500",
    Air: "from-sky-400 to-blue-500",
    Water: "from-blue-500 to-indigo-600",
  };

  const steps = [
    { id: "1", label: "Calculating zodiac sign", status: currentStep > 0 ? "completed" : currentStep === 0 ? "in_progress" : "pending" },
    { id: "2", label: "Analyzing personality traits", status: currentStep > 1 ? "completed" : currentStep === 1 ? "in_progress" : "pending" },
    { id: "3", label: "Determining compatibility", status: currentStep > 2 ? "completed" : currentStep === 2 ? "in_progress" : "pending" },
    { id: "4", label: "Generating daily forecast", status: currentStep > 3 ? "completed" : currentStep === 3 ? "in_progress" : "pending" },
    { id: "5", label: "Computing personality matrix", status: currentStep > 4 ? "completed" : currentStep === 4 ? "in_progress" : "pending" },
  ] as const;

  const advanceStep = () => {
    setCurrentStep((s) => Math.min(s + 1, 5));
  };

  const resetDemo = () => {
    setCurrentStep(0);
    setIsStreaming(false);
  };

  const PersonalityBar = ({ label, value }: { label: string; value: number }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-[var(--text-muted)]">{label}</span>
      <div className="flex-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${elementColors[sign.element]} transition-all duration-500`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-[var(--text-primary)]">{value}%</span>
    </div>
  );

  return (
    <div>
      <DemoHeader
        title="Cosmic Profile Generator"
        description="Personalized horoscope and personality analysis. Demonstrates generative forms, state building, and streaming text."
        events={["GENERATIVE_UI_FORM", "STATE_SNAPSHOT", "STATE_DELTA", "TEXT_MESSAGE_*"]}
      />

      <div className="flex gap-4 mb-6">
        <select
          value={selectedSign}
          onChange={(e) => setSelectedSign(e.target.value)}
          className="select text-sm"
        >
          {Object.entries(ZODIAC_DATA).map(([key, data]) => (
            <option key={key} value={key}>
              {data.symbol} {key.charAt(0).toUpperCase() + key.slice(1)}
            </option>
          ))}
        </select>
        <button onClick={advanceStep} disabled={currentStep >= 5} className="btn btn-primary">
          {currentStep >= 5 ? "Complete" : "Next Step"}
        </button>
        <button onClick={resetDemo} className="btn btn-secondary">
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Card - Reading Progress */}
        <ActivityCard
          type="plan"
          title="Reading the Stars..."
          steps={steps.map(s => ({ ...s, status: s.status as "pending" | "in_progress" | "completed" | "failed" }))}
          currentStep={currentStep}
        />

        {/* Zodiac Sign Card */}
        {currentStep >= 1 && (
          <div className={`rounded-xl border border-[var(--border)] bg-gradient-to-br ${elementColors[sign.element]} p-4 animate-fade-in`}>
            <div className="flex items-center gap-4">
              <div className="text-5xl">{sign.symbol}</div>
              <div className="text-white">
                <h3 className="text-xl font-bold">{selectedSign.charAt(0).toUpperCase() + selectedSign.slice(1)}</h3>
                <p className="text-sm opacity-80">{sign.dates}</p>
                <div className="flex gap-2 mt-2">
                  <span className="text-xs px-2 py-0.5 bg-white/20 rounded">{sign.element}</span>
                  <span className="text-xs px-2 py-0.5 bg-white/20 rounded">{sign.planet}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Personality Traits */}
        {currentStep >= 2 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span>✨</span> Personality Traits
            </h4>
            <div className="flex flex-wrap gap-2">
              {sign.traits.map((trait) => (
                <span
                  key={trait}
                  className={`px-3 py-1 text-sm rounded-full bg-gradient-to-r ${elementColors[sign.element]} text-white`}
                >
                  {trait}
                </span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-[var(--bg-primary)] rounded">
                <span className="text-[var(--text-muted)]">Love Style:</span>
                <p className="text-[var(--text-primary)]">
                  {sign.element === "Fire" ? "Passionate & Bold" : sign.element === "Earth" ? "Steady & Devoted" : sign.element === "Air" ? "Intellectual & Playful" : "Deep & Emotional"}
                </p>
              </div>
              <div className="p-2 bg-[var(--bg-primary)] rounded">
                <span className="text-[var(--text-muted)]">Friendship:</span>
                <p className="text-[var(--text-primary)]">
                  {sign.element === "Fire" ? "Adventurous" : sign.element === "Earth" ? "Reliable" : sign.element === "Air" ? "Stimulating" : "Empathetic"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Compatibility */}
        {currentStep >= 3 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span>💕</span> Compatibility
            </h4>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Best Matches</p>
                <div className="flex gap-2">
                  {sign.compatible.map((match) => (
                    <span key={match} className="px-3 py-1 text-sm bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                      {ZODIAC_DATA[match.toLowerCase()]?.symbol} {match}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Challenging Matches</p>
                <div className="flex gap-2">
                  {Object.entries(ZODIAC_DATA)
                    .filter(([_, d]) => d.element !== sign.element)
                    .slice(0, 2)
                    .map(([key, data]) => (
                      <span key={key} className="px-3 py-1 text-sm bg-red-500/20 text-red-400 rounded-full border border-red-500/30">
                        {data.symbol} {key.charAt(0).toUpperCase() + key.slice(1)}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Daily Forecast */}
        {currentStep >= 4 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span>🌟</span> Today's Forecast
            </h4>
            <div className="space-y-3">
              <div className="p-3 bg-[var(--bg-primary)] rounded">
                <p className="text-xs text-[var(--text-muted)]">Overall</p>
                <p className="text-sm text-[var(--text-primary)]">The stars align in your favor today. Trust your intuition.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-[var(--bg-primary)] rounded text-center">
                  <p className="text-[10px] text-[var(--text-muted)]">Love</p>
                  <p className="text-lg">💕</p>
                </div>
                <div className="p-2 bg-[var(--bg-primary)] rounded text-center">
                  <p className="text-[10px] text-[var(--text-muted)]">Career</p>
                  <p className="text-lg">📈</p>
                </div>
                <div className="p-2 bg-[var(--bg-primary)] rounded text-center">
                  <p className="text-[10px] text-[var(--text-muted)]">Health</p>
                  <p className="text-lg">🧘</p>
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <div>
                  <span className="text-[var(--text-muted)]">Lucky Numbers: </span>
                  <span className="text-[var(--text-primary)] font-mono">7, 21, 33</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Lucky Color: </span>
                  <span className="text-purple-400">Purple</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Personality Matrix */}
        {currentStep >= 5 && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4 lg:col-span-2">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span>🧬</span> Personality Matrix
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <PersonalityBar label="Introversion" value={sign.element === "Water" ? 72 : sign.element === "Earth" ? 58 : 35} />
                <PersonalityBar label="Intuition" value={sign.element === "Water" ? 85 : sign.element === "Fire" ? 65 : 50} />
                <PersonalityBar label="Thinking" value={sign.element === "Air" ? 78 : sign.element === "Earth" ? 70 : 45} />
                <PersonalityBar label="Judging" value={sign.element === "Earth" ? 80 : sign.element === "Fire" ? 40 : 55} />
              </div>
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl mb-2">{sign.symbol}</div>
                  <p className="text-sm text-[var(--text-muted)]">
                    {sign.element === "Fire" ? "ENFP - The Campaigner" :
                     sign.element === "Earth" ? "ISTJ - The Logistician" :
                     sign.element === "Air" ? "ENTP - The Debater" :
                     "INFJ - The Advocate"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mystical Message - Streaming Text */}
        {currentStep >= 5 && (
          <div className="lg:col-span-2">
            <StreamingText
              content={`Dear ${selectedSign.charAt(0).toUpperCase() + selectedSign.slice(1)}, as the ${sign.planet} guides your path through the celestial realm, remember that your ${sign.element.toLowerCase()} nature is both your strength and your teacher. The cosmos whisper of great opportunities ahead - trust in the journey, for the stars have aligned in your favor.`}
              role="assistant"
              isStreaming={isStreaming}
            />
            <button
              onClick={() => setIsStreaming(!isStreaming)}
              className="mt-2 btn btn-ghost text-xs"
            >
              {isStreaming ? "Stop Streaming" : "Simulate Streaming"}
            </button>
          </div>
        )}

        {/* Input Form */}
        <div className="lg:col-span-2">
          <GenerativeForm
            schema={horoscopeFormSchema}
            onSubmit={(data) => console.log("Profile submitted:", data)}
          />
        </div>
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
