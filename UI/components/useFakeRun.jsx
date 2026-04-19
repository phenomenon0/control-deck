// Fake agent run engine — drives the three variations' timelines.
// Mirrors the RunState machine from BEHAVIOR.md §2:
//   idle → submitted → thinking → executing → streaming → idle

const { useState, useRef, useCallback, useEffect } = React;

function useFakeRun({ onComplete } = {}) {
  const [phase, setPhase] = useState("idle");
  const [tool, setTool] = useState(null);
  const [streamed, setStreamed] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [ops, setOps] = useState([]); // [{tool,label,arg,dur,status}]
  const [artifact, setArtifact] = useState(null);
  const startedAt = useRef(0);
  const timers = useRef([]);
  const stopped = useRef(false);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = () => {
    clearTimers();
    stopped.current = false;
    setPhase("idle");
    setTool(null);
    setStreamed("");
    setElapsed(0);
    setOps([]);
    setArtifact(null);
  };

  const stop = () => {
    stopped.current = true;
    clearTimers();
    setPhase("idle");
    setTool(null);
  };

  // elapsed tick
  useEffect(() => {
    if (phase === "idle" || phase === "error") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 80);
    return () => clearInterval(id);
  }, [phase]);

  const run = useCallback(({ operations, finalText, finalArtifact }) => {
    clearTimers();
    stopped.current = false;
    startedAt.current = Date.now();
    setElapsed(0);
    setStreamed("");
    setOps(operations.map((o) => ({ ...o, status: "pending" })));
    setArtifact(null);
    setPhase("submitted");
    setTool(null);

    const push = (ms, fn) => timers.current.push(setTimeout(() => { if (!stopped.current) fn(); }, ms));

    // 1. submitted → thinking
    push(350, () => setPhase("thinking"));

    // 2. schedule ops
    let t = 900;
    operations.forEach((op, i) => {
      push(t, () => {
        setPhase("executing");
        setTool(op.tool);
        setOps((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "running" } : p));
      });
      t += op.dur;
      push(t, () => {
        setOps((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "done" } : p));
      });
    });

    // 3. streaming phase
    push(t + 100, () => { setPhase("streaming"); setTool(null); });

    // 4. type out finalText at variable speed
    let streamStart = t + 220;
    const chars = finalText.split("");
    let soFar = "";
    chars.forEach((ch, i) => {
      streamStart += /[.?!\n]/.test(ch) ? 32 : ch === " " ? 10 : 8;
      push(streamStart, () => {
        soFar += ch;
        setStreamed(soFar);
      });
    });

    // 5. artifact appear partway through stream
    if (finalArtifact) {
      push(t + 700, () => setArtifact(finalArtifact));
    }

    // 6. done
    push(streamStart + 300, () => {
      setPhase("idle");
      setTool(null);
      onComplete?.();
    });
  }, [onComplete]);

  return { phase, tool, streamed, elapsed, ops, artifact, run, stop, reset,
           isRunning: phase !== "idle" && phase !== "error" };
}

window.useFakeRun = useFakeRun;
