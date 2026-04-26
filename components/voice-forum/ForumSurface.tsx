"use client";

/**
 * ForumSurface — Audio Forum view (wireframes v3 · modality 05).
 *
 * Column-per-agent layout. Each agent has its own thread, its own state —
 * idle, thinking, live. Quotes between columns are visible. The user can
 * speak into any one of them and the deck routes by name (or by the open
 * mic). Presentational scaffold; wire to a multi-agent session bus when one
 * exists.
 */

interface Message {
  who: string;
  whoClass?: "" | "is-accent";
  body: React.ReactNode;
  self?: boolean;
  when?: string;
}

interface AgentColumn {
  id: string;
  name: string;
  role: string;
  initial: string;
  state: "idle" | "live" | "thinking";
  avatarClass?: "" | "is-ok" | "is-think";
  thread: Message[];
  inputHint: string;
}

const AGENTS: AgentColumn[] = [
  {
    id: "archivist",
    name: "Archivist",
    role: "read-only · history",
    initial: "A",
    state: "idle",
    thread: [
      {
        who: "archivist",
        body: (
          <>
            Last incident with this signature: <b>2026-02-11</b>, same SDK family. Resolved by pinning the refresh boundary one layer up.
          </>
        ),
      },
      { who: "you", body: "Pull the postmortem." },
      {
        who: "archivist",
        whoClass: "is-accent",
        self: true,
        when: "21:14",
        body: "Postmortem fetched. 3 sections, 1,200 words. Linked above.",
      },
    ],
    inputHint: "route to archivist…",
  },
  {
    id: "operator",
    name: "Operator",
    role: "live · gateway shell",
    initial: "O",
    state: "live",
    avatarClass: "is-ok",
    thread: [
      {
        who: "operator",
        whoClass: "is-accent",
        self: true,
        body: (
          <>
            Three 401 matches in 18 min. All client SDK <span style={{ fontFamily: "var(--au-mono)" }}>v3.4.1</span>. Same auth path.
          </>
        ),
      },
      { who: "you", body: "Trace one." },
      {
        who: "operator",
        whoClass: "is-accent",
        self: true,
        when: "21:18",
        body: (
          <>
            Trace open. 12 spans.
            <div className="fr-msg__quote">
              From Archivist: &ldquo;pinning the refresh boundary one layer up&rdquo; — applies here.
            </div>
            Want me to draft the patch?
          </>
        ),
      },
    ],
    inputHint: "route to operator…",
  },
  {
    id: "scribe",
    name: "Scribe",
    role: "writes notes · dispatch",
    initial: "S",
    state: "thinking",
    avatarClass: "is-think",
    thread: [
      { who: "scribe", body: "Drafting incident note from Operator's trace…" },
      {
        who: "scribe",
        whoClass: "is-accent",
        self: true,
        when: "21:18",
        body: (
          <>
            Title: <b>&ldquo;401 cluster on auth-gateway, SDK v3.4.1&rdquo;</b>
            <br />
            Lede: 18-minute window, three matches, no retries from client.
            <div className="fr-msg__quote">
              Quoting Operator: &ldquo;pinning the refresh at the wrong spot.&rdquo;
            </div>
            Ready to save to /notes when you're ready.
          </>
        ),
      },
    ],
    inputHint: "route to scribe…",
  },
];

function stateClass(s: AgentColumn["state"]) {
  if (s === "live") return "fr-col__state is-live";
  if (s === "thinking") return "fr-col__state is-thinking";
  return "fr-col__state";
}

export function ForumSurface() {
  return (
    <div className="fr-grid">
      {AGENTS.map((agent) => (
        <div key={agent.id} className="fr-col">
          <div className="fr-col__head">
            <div className={`fr-col__avatar ${agent.avatarClass ?? ""}`}>{agent.initial}</div>
            <div>
              <div className="fr-col__name">{agent.name}</div>
              <div className="fr-col__role">{agent.role}</div>
            </div>
            <span className={stateClass(agent.state)}>{agent.state}</span>
          </div>
          <div className="fr-thread">
            {agent.thread.map((m, i) => (
              <div key={i} className={`fr-msg${m.self ? " is-self" : ""}`}>
                <span className={`fr-msg__who ${m.whoClass ?? ""}`}>{m.who}</span>
                {m.body}
                {m.when && <span className="fr-msg__when">{m.when}</span>}
              </div>
            ))}
          </div>
          <div className="fr-input">
            <span className="fr-input__mic">{agent.initial}</span>
            <span>{agent.inputHint}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
