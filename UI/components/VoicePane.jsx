// VoicePane — Studio console. Waveform, engines, transcript, synthesis.

const VOICE_ENGINES = [
  { id: "piper",      name: "Piper",      tagline: "Fast, robotic",           latency: "140ms", voices: 12, size: "0.4 GB" },
  { id: "xtts",       name: "XTTS v2",    tagline: "Human-like, 58 voices",   latency: "620ms", voices: 58, size: "2.1 GB" },
  { id: "chatterbox", name: "Chatterbox", tagline: "Most expressive",         latency: "1.2s",  voices: 6,  size: "3.4 GB" },
];

const VOICE_LIBRARY = [
  { id: "jenny",    engine:"xtts",       name: "Jenny",    age: "adult", tone: "warm · steady",   lang: "en-us" },
  { id: "ryan",     engine:"piper",      name: "Ryan",     age: "adult", tone: "neutral · clean", lang: "en-us" },
  { id: "aurora",   engine:"chatterbox", name: "Aurora",   age: "adult", tone: "breathy · soft",  lang: "en-us" },
  { id: "kathleen", engine:"xtts",       name: "Kathleen", age: "elder", tone: "narrative · dry", lang: "en-gb" },
  { id: "ember",    engine:"chatterbox", name: "Ember",    age: "adult", tone: "low · confiding", lang: "en-us" },
  { id: "lark",     engine:"piper",      name: "Lark",     age: "young", tone: "bright · quick",  lang: "en-us" },
];

const VOICE_TRANSCRIPT = [
  { who: "user", t: "14:02:18", text: "Take this paragraph and give me Aurora reading it, slower than normal." },
  { who: "deck", t: "14:02:19", text: "Reading in Aurora · Chatterbox · rate 0.85×. I'll mark breath pauses at commas." },
  { who: "user", t: "14:03:02", text: "Warmer in the lower register. And drop the S's a touch." },
  { who: "deck", t: "14:03:04", text: "Adjusting · low-shelf +2.4 dB, de-esser 4 kHz. Synthesizing again." },
];

function Waveform({ animated }) {
  // generate a mix of bars
  const bars = Array.from({ length: 80 }, (_, i) => {
    const base = Math.abs(Math.sin(i * 0.24)) * 0.55 +
                 Math.abs(Math.cos(i * 0.71)) * 0.25 +
                 Math.abs(Math.sin(i * 1.37)) * 0.18;
    return Math.min(1, base);
  });
  return (
    <div className={`waveform ${animated ? "on" : ""}`}>
      {bars.map((v, i) => (
        <span key={i} style={{
          height: `${8 + v * 52}px`,
          animationDelay: animated ? `${(i % 10) * 60}ms` : undefined
        }}/>
      ))}
    </div>
  );
}

function VoicePane() {
  const [engine, setEngine] = useS("chatterbox");
  const [voice, setVoice]   = useS("aurora");
  const [listening, setListening] = useS(false);
  const [speaking, setSpeaking] = useS(false);
  const [text, setText] = useS("Retention didn't break in the product — it broke in the funnel. Paid acquisition jumped forty-one percent in Q3.");
  const [mode, setMode] = useS("push-to-talk");

  const voices = VOICE_LIBRARY.filter((v) => v.engine === engine);

  return (
    <>
      <TopBar title="Voice" subtitle="Studio" model={`${engine} · ${voice}`}/>
      <div className="voice-stage">

        <div className="voice-head">
          <div className="label">Studio · mic + synthesis</div>
          <h1>The deck, spoken aloud.</h1>
          <p>Pick an engine, a voice, and a mode. Speak into the mic or paste a script. The console reads both ways.</p>
        </div>

        {/* Main console: waveform + controls + transcript */}
        <div className="voice-console">
          <div className="voice-main">
            <div className="voice-state">
              <span className={`voice-ring voice-ring--${listening ? "listen" : speaking ? "speak" : "idle"}`}/>
              <div>
                <div className="label">{listening ? "listening" : speaking ? "speaking" : "idle"}</div>
                <div className="voice-state-big">
                  {listening ? "Take it down." : speaking ? "Reading aloud." : "Ready when you are."}
                </div>
              </div>
              <div className="voice-state-meta mono">
                <div><span>engine</span><b>{engine}</b></div>
                <div><span>voice</span><b>{voice}</b></div>
                <div><span>rate</span><b>0.85×</b></div>
                <div><span>pitch</span><b>−2 st</b></div>
              </div>
            </div>

            <Waveform animated={listening || speaking}/>

            <div className="voice-transport">
              <button className={`voice-big ${listening ? "on" : ""}`} onClick={()=>{setListening(!listening); setSpeaking(false);}}>
                {listening ? "Stop" : "Hold to speak"}
              </button>
              <button className={`voice-big voice-big--alt ${speaking ? "on" : ""}`}
                      onClick={()=>{setSpeaking(!speaking); setListening(false);}}>
                {speaking ? "Stop reading" : "Read script"}
              </button>
              <div className="voice-mode">
                <div className="label">mic mode</div>
                {["push-to-talk","toggle","continuous"].map((m) => (
                  <button key={m} className={`voice-mode-opt ${mode===m?"on":""}`} onClick={()=>setMode(m)}>{m}</button>
                ))}
              </div>
            </div>

            <div className="voice-script">
              <div className="label">Script</div>
              <textarea value={text} onChange={(e)=>setText(e.target.value)}/>
              <div className="voice-script-foot">
                <span className="label">{text.length} chars · ~{Math.round(text.split(/\s+/).length/2.7)}s at 0.85×</span>
                <button className="pill pill--ghost">Save take</button>
                <button className="pill">Synthesize</button>
              </div>
            </div>
          </div>

          {/* Right rail: transcript */}
          <div className="voice-side">
            <div className="label">Session transcript</div>
            <div className="voice-transcript">
              {VOICE_TRANSCRIPT.map((m,i) => (
                <div key={i} className={`vt vt--${m.who}`}>
                  <div className="vt-head">
                    <span className="label">{m.who === "user" ? "you" : "deck"}</span>
                    <span className="mono vt-t">{m.t}</span>
                  </div>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
            <button className="pill pill--ghost" style={{marginTop:8, width:"100%"}}>Export as .wav</button>
          </div>
        </div>

        {/* Engine + voice library */}
        <div className="sect-head">
          <div className="label">Engines · 3 available</div>
          <span className="sect-head-sub">running locally on voice-api:8000</span>
        </div>
        <div className="voice-engines">
          {VOICE_ENGINES.map((e) => (
            <div key={e.id} className={`voice-engine ${engine===e.id?"on":""}`} onClick={()=>setEngine(e.id)}>
              <div className="voice-engine-top">
                <div>
                  <div className="voice-engine-name">{e.name}</div>
                  <div className="voice-engine-tag">{e.tagline}</div>
                </div>
                <span className="mono voice-engine-latency">{e.latency}</span>
              </div>
              <div className="voice-engine-foot">
                <span><b>{e.voices}</b> voices</span>
                <span className="mono">{e.size}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="sect-head" style={{marginTop:8}}>
          <div className="label">Voices · {voices.length} in {engine}</div>
          <span className="sect-head-sub">hover to audition</span>
        </div>
        <div className="voice-library">
          {voices.map((v) => (
            <div key={v.id} className={`voice-card ${voice===v.id?"on":""}`} onClick={()=>setVoice(v.id)}>
              <div className="voice-card-top">
                <span className="voice-card-name">{v.name}</span>
                <span className="mono voice-card-lang">{v.lang}</span>
              </div>
              <div className="voice-card-wave">
                {Array.from({length:18}).map((_,i) => {
                  const h = 4 + Math.abs(Math.sin((v.name.charCodeAt(0)+i)*0.6))*20;
                  return <span key={i} style={{height:h}}/>;
                })}
              </div>
              <div className="voice-card-meta">
                <span className="label">{v.age}</span>
                <span>{v.tone}</span>
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}

window.VoicePane = VoicePane;
