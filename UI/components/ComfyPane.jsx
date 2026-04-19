// ComfyPane — Workflow gallery + queue. Film plates + VRAM gauge.

const COMFY_WORKFLOWS = [
  { id: "flux-s",   name: "Flux Schnell",    sub: "text → image",  vram: "11.3 GB", time: "2.1s/img" },
  { id: "qwen-ed",  name: "Qwen Edit",       sub: "image → edit",  vram: "14.8 GB", time: "6.4s/img" },
  { id: "hunyuan",  name: "Hunyuan 3D",      sub: "image → mesh",  vram: "18.4 GB", time: "42s/obj" },
  { id: "sab",      name: "Stable Audio",    sub: "text → audio",  vram: "9.7 GB",  time: "8.2s/clip" },
  { id: "sdxl-l",   name: "SDXL Lightning",  sub: "text → image",  vram: "8.1 GB",  time: "0.9s/img" },
];

const COMFY_OUTPUTS = [
  { id: "o1", wf: "flux-s",  name: "hero_forest_moss_03.png", prompt: "golden-hour forest floor, moss, deep green, cinematic",    dim:"1920×1080", when:"2 min ago", tag:"keep" },
  { id: "o2", wf: "flux-s",  name: "terminal_plate_03.png",   prompt: "dark warm terminal window on earthy background, matte",    dim:"1600×1200", when:"14 min ago", tag:"keep" },
  { id: "o3", wf: "qwen-ed", name: "shap_card_edit_01.png",   prompt: "edit: replace legend with squared matter caption, warm",   dim:"1200×800",  when:"38 min ago" },
  { id: "o4", wf: "flux-s",  name: "retention_mood_05.png",   prompt: "abstract cohort drift, pale amber on charcoal, no text",   dim:"1600×900",  when:"1 hr ago" },
  { id: "o5", wf: "sdxl-l",  name: "hero_mist_ridge_02.png",  prompt: "misty ridge, monochrome warm, soft grain, wide",           dim:"2048×1152", when:"2 hr ago", tag:"keep" },
  { id: "o6", wf: "flux-s",  name: "cta_pill_backdrop.png",   prompt: "earthy pill shape on charcoal, soft bokeh, subtle grain",  dim:"1600×900",  when:"3 hr ago" },
  { id: "o7", wf: "hunyuan", name: "dial_base_turntable.glb", prompt: "circular instrument base, matte brass, industrial",        dim:"mesh · 42k tris", when:"4 hr ago" },
  { id: "o8", wf: "flux-s",  name: "quiet_oak_08.png",        prompt: "single oak tree, dawn, negative space, warm parchment sky",dim:"1920×1080", when:"5 hr ago" },
];

const COMFY_QUEUE = [
  { id: "q1", wf: "flux-s",  status: "running", progress: 0.62, eta: "0.8s", prompt: "warm tungsten kitchen, shallow focus" },
  { id: "q2", wf: "qwen-ed", status: "queued",  progress: 0,    eta: "6s",   prompt: "edit: warm up white balance, -200k" },
  { id: "q3", wf: "sab",     status: "queued",  progress: 0,    eta: "12s",  prompt: "low drone, 60s, ambient, wooden" },
];

function ComfyPane() {
  const [wf, setWf] = useS("flux-s");
  const [prompt, setPrompt] = useS("golden-hour forest floor, moss, deep green, cinematic");
  const filtered = COMFY_OUTPUTS.filter((o) => wf === "all" || o.wf === wf);

  return (
    <>
      <TopBar title="Comfy" subtitle="Workflows" model="comfyui · local" />
      <div className="comfy-stage">

        <div className="comfy-head">
          <div className="label">Workflows · 5 loaded · queue 3</div>
          <h1>A darkroom for the agent.</h1>
          <p>Every image, audio clip, and mesh the deck has rendered — with the prompt that made it and the VRAM it cost.</p>
        </div>

        {/* Composer */}
        <div className="comfy-composer">
          <div className="comfy-comp-left">
            <div className="label">Compose</div>
            <div className="comfy-comp-wf">
              {COMFY_WORKFLOWS.map((w) => (
                <button key={w.id} className={`comfy-wf ${wf===w.id?"on":""}`} onClick={()=>setWf(w.id)}>
                  <div className="comfy-wf-name">{w.name}</div>
                  <div className="comfy-wf-sub">{w.sub}</div>
                  <div className="comfy-wf-meta mono"><span>{w.vram}</span><span>{w.time}</span></div>
                </button>
              ))}
            </div>
            <textarea className="comfy-prompt" value={prompt} onChange={(e)=>setPrompt(e.target.value)}
                      placeholder="Describe the frame. Be editorial."/>
            <div className="comfy-comp-foot">
              <div className="comfy-knobs">
                <label>size</label><select><option>1920×1080</option><option>1600×900</option><option>1024×1024</option></select>
                <label>seed</label><input className="mono" defaultValue="0x7F3A"/>
                <label>steps</label><input type="number" defaultValue="4" style={{width:60}}/>
                <label>guidance</label><input type="number" defaultValue="3.5" step="0.1" style={{width:60}}/>
              </div>
              <button className="pill">Queue render</button>
            </div>
          </div>

          <div className="comfy-comp-right">
            <div className="label">Queue · {COMFY_QUEUE.length}</div>
            <div className="comfy-queue">
              {COMFY_QUEUE.map((q) => (
                <div key={q.id} className={`comfy-qitem comfy-qitem--${q.status}`}>
                  <div className="comfy-qitem-top">
                    <span className="mono">{q.id}</span>
                    <span className="label" style={{marginLeft:8}}>{q.wf}</span>
                    <span className="comfy-qitem-eta mono" style={{marginLeft:"auto"}}>{q.eta}</span>
                  </div>
                  <div className="comfy-qitem-prompt">{q.prompt}</div>
                  {q.status === "running" && (
                    <div className="comfy-qitem-bar"><div style={{width:`${q.progress*100}%`}}/></div>
                  )}
                </div>
              ))}
            </div>

            <div className="comfy-vram">
              <div className="label">VRAM</div>
              <div className="comfy-vram-row">
                <span>flux-schnell</span><span className="mono">5.4 GB</span>
              </div>
              <div className="comfy-vram-row">
                <span>clip-vit-l</span><span className="mono">1.7 GB</span>
              </div>
              <div className="comfy-vram-row">
                <span>free</span><span className="mono">8.6 GB</span>
              </div>
              <div className="comfy-vram-bar">
                <div style={{width:"22%", background:"var(--accent)"}}/>
                <div style={{width:"7%",  background:"var(--sage)"}}/>
                <div style={{width:"36%", background:"var(--ember)"}}/>
              </div>
              <button className="pill pill--ghost" style={{marginTop:10, width:"100%"}}>Free all · unload models</button>
            </div>
          </div>
        </div>

        {/* Outputs gallery */}
        <div className="sect-head" style={{marginTop:10}}>
          <div className="label">Darkroom · {filtered.length} plates</div>
          <div className="comfy-filter">
            <button className={wf==="all"?"on":""} onClick={()=>setWf("all")}>all</button>
            {COMFY_WORKFLOWS.map((w) => (
              <button key={w.id} className={wf===w.id?"on":""} onClick={()=>setWf(w.id)}>{w.name}</button>
            ))}
          </div>
        </div>

        <div className="comfy-gallery">
          {filtered.map((o) => (
            <div key={o.id} className="comfy-plate">
              <div className="comfy-plate-img">
                <Viz.Atmosphere seed={parseInt(o.id.slice(1))}/>
                <span className="comfy-plate-wf mono">{o.wf}</span>
                {o.tag && <span className="comfy-plate-tag">{o.tag}</span>}
              </div>
              <div className="comfy-plate-body">
                <div className="comfy-plate-name mono">{o.name}</div>
                <div className="comfy-plate-prompt">{o.prompt}</div>
                <div className="comfy-plate-foot">
                  <span className="mono">{o.dim}</span>
                  <span className="label">{o.when}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}

window.ComfyPane = ComfyPane;
