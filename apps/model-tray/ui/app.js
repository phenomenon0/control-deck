const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;

const state = {
  snapshot: null,
  selectedProviderId: null,
  query: "",
  capability: "all",
  busy: false,
  log: ["Ready."],
};

const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  lastUpdated: document.getElementById("lastUpdated"),
  statusStrip: document.getElementById("statusStrip"),
  providerCount: document.getElementById("providerCount"),
  providerList: document.getElementById("providerList"),
  selectedProviderName: document.getElementById("selectedProviderName"),
  selectedProviderMeta: document.getElementById("selectedProviderMeta"),
  forceLoad: document.getElementById("forceLoad"),
  modelSearch: document.getElementById("modelSearch"),
  copyBaseBtn: document.getElementById("copyBaseBtn"),
  startProviderBtn: document.getElementById("startProviderBtn"),
  capabilityFilters: document.getElementById("capabilityFilters"),
  endpointList: document.getElementById("endpointList"),
  scanPanel: document.getElementById("scanPanel"),
  modelList: document.getElementById("modelList"),
  actionLog: document.getElementById("actionLog"),
  clearLogBtn: document.getElementById("clearLogBtn"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${Math.round(mb)} MB`;
}

function formatVramBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${formatBytes(bytes)} VRAM`;
}

function readableCapability(value) {
  const labels = {
    all: "All",
    llm: "LLM",
    image: "Image",
    stt: "STT",
    tts: "TTS",
    embedding: "Embed",
    cache: "Cache",
  };
  return labels[value] ?? value;
}

function modelCapabilities(model, provider) {
  const values = model.capabilities?.length ? model.capabilities : provider.capabilities ?? [];
  return values.length ? values : ["unknown"];
}

function matchesCapability(model, provider) {
  if (state.capability === "all") return true;
  return modelCapabilities(model, provider).includes(state.capability);
}

function modelServeTargets(model) {
  return model.serveTargets ?? [];
}

function canProviderStart(provider) {
  if (!provider?.scan?.installed || !provider.manageable || provider.status === "online") return false;
  return !["huggingface", "whisper"].includes(provider.id);
}

function rowAction(provider, model, isLoaded) {
  if (isLoaded) {
    return { label: "Unload", className: "secondary unload-model", disabled: false, title: "Unload" };
  }

  const targets = modelServeTargets(model);
  if (!provider.manageable || !provider.scan?.installed) {
    return { label: "Missing", className: "load-model", disabled: true, title: "Provider not detected" };
  }

  if (provider.id === "huggingface" && !targets.length) {
    return { label: "Catalog", className: "load-model", disabled: true, title: "No serve adapter inferred for this cache row" };
  }

  if (provider.id === "whisper" && !targets.includes("whisper-server")) {
    return { label: "CLI", className: "load-model", disabled: true, title: "Detected as a Whisper CLI asset, not a faster-whisper server target" };
  }

  const labels = {
    "piper-tts": "Serve",
    whisper: "Serve",
    comfyui: provider.status === "online" ? "Open" : "Start",
    huggingface: "Serve",
  };
  return {
    label: labels[provider.id] ?? (provider.status === "online" ? "Load" : "Start"),
    className: "load-model",
    disabled: false,
    title: targets.length ? `Serve via ${targets.join(", ")}` : "Start provider and load this model",
  };
}

function providerStatusClass(status) {
  if (status === "online") return "online";
  if (status === "offline") return "offline";
  return "degraded";
}

function pressureClass(pressure) {
  if (!pressure || pressure.state === "unknown") return "status-warn";
  if (pressure.state === "ok") return "status-ok";
  if (pressure.state === "warning") return "status-warn";
  return "status-bad";
}

function selectedProvider() {
  const providers = state.snapshot?.providers ?? [];
  return providers.find((provider) => provider.id === state.selectedProviderId) ?? providers[0] ?? null;
}

function appendLog(message) {
  const time = new Date().toLocaleTimeString();
  state.log.unshift(`[${time}] ${message}`);
  state.log = state.log.slice(0, 50);
  els.actionLog.textContent = state.log.join("\n");
}

async function call(command, args) {
  if (!invoke) {
    throw new Error("Tauri invoke API is unavailable. Run this through `tauri dev`.");
  }
  return invoke(command, args);
}

async function loadSnapshot(command = "get_state") {
  if (state.busy) return;
  state.busy = true;
  els.refreshBtn.disabled = true;
  try {
    const snapshot = await call(command);
    state.snapshot = snapshot;
    if (!state.selectedProviderId && snapshot.providers?.length) {
      state.selectedProviderId = snapshot.providers[0].id;
    }
    render();
  } catch (error) {
    appendLog(error.message ?? String(error));
  } finally {
    state.busy = false;
    els.refreshBtn.disabled = false;
  }
}

async function copyEndpoint(endpoint) {
  try {
    const result = await call("copy_endpoint", { request: { endpoint } });
    appendLog(result.message);
  } catch (error) {
    appendLog(error.message ?? String(error));
  }
}

async function loadModel(providerId, model) {
  try {
    const result = await call("load_model", {
      request: {
        providerId,
        model,
        force: els.forceLoad.checked,
        keepAlive: "30m",
      },
    });
    appendLog(result.message);
    if (result.endpointUrl) await copyEndpoint(result.endpointUrl);
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    await loadSnapshot("refresh_state");
  } catch (error) {
    appendLog(error.message ?? String(error));
  }
}

async function unloadModel(providerId, model) {
  try {
    const result = await call("unload_model", {
      request: { providerId, model },
    });
    appendLog(result.message);
    await loadSnapshot("refresh_state");
  } catch (error) {
    appendLog(error.message ?? String(error));
  }
}

async function startProvider(providerId) {
  try {
    const result = await call("start_provider", {
      request: { providerId },
    });
    appendLog(result.message);
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    await loadSnapshot("refresh_state");
  } catch (error) {
    appendLog(error.message ?? String(error));
  }
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const provider = selectedProvider();
  const providers = snapshot.providers ?? [];
  const gpu = snapshot.gpu;
  const pressure = snapshot.pressure;
  const tools = snapshot.detectedTools ?? [];
  const installedToolCount = tools.filter((tool) => tool.installed).length;
  const loadedCount = providers.reduce((count, item) => count + (item.loadedModels?.length ?? 0), 0);
  const onlineCount = providers.filter((item) => item.status === "online").length;
  const installedProviderCount = providers.filter((item) => item.scan?.installed).length;
  const availableCapabilities = ["all", ...new Set(providers.flatMap((item) => [
    ...(item.capabilities ?? []),
    ...(item.installedModels ?? []).flatMap((model) => model.capabilities ?? []),
  ]))];

  els.lastUpdated.textContent = new Date(Number(snapshot.timestampMs)).toLocaleTimeString();
  els.providerCount.textContent = String(providers.length);

  els.statusStrip.innerHTML = `
    <div class="status-cell ${gpu ? "status-ok" : "status-bad"}">
      <span>GPU</span>
      <strong>${escapeHtml(gpu?.name ?? "Unavailable")}</strong>
      <span>${escapeHtml(snapshot.gpuWarning ?? (gpu ? `${gpu.utilizationPercent}% util, ${gpu.temperatureC} C` : "No GPU state"))}</span>
    </div>
    <div class="status-cell ${pressureClass(pressure)}">
      <span>VRAM Guard</span>
      <strong>${escapeHtml(pressure?.state ?? "unknown")}</strong>
      <span>${escapeHtml(pressure?.message ?? "No pressure data")}</span>
    </div>
    <div class="status-cell ${onlineCount > 0 ? "status-ok" : "status-warn"}">
      <span>Providers</span>
      <strong>${onlineCount}/${providers.length} online</strong>
      <span>${loadedCount} loaded model${loadedCount === 1 ? "" : "s"}</span>
    </div>
    <div class="status-cell ${installedProviderCount ? "status-ok" : "status-warn"}">
      <span>System Scan</span>
      <strong>${installedProviderCount}/${providers.length} loaders</strong>
      <span>${escapeHtml(tools.filter((tool) => tool.installed).slice(0, 2).map((tool) => tool.name).join(", ") || "Discovery-first scan")}</span>
    </div>
  `;

  els.capabilityFilters.innerHTML = availableCapabilities.map((capability) => `
    <button class="capability-chip${state.capability === capability ? " active" : ""}" type="button" data-capability="${escapeHtml(capability)}">
      ${escapeHtml(readableCapability(capability))}
    </button>
  `).join("");

  els.providerList.innerHTML = providers.map((item) => {
    const active = item.id === provider?.id ? " active" : "";
    const statusClass = providerStatusClass(item.status);
    const modelCount = item.installedModels?.length ?? 0;
    const loaded = item.loadedModels?.length ?? 0;
    const installState = item.scan?.installed ? "installed" : "not found";
    const caps = (item.capabilities ?? []).map(readableCapability).join("/");
    return `
      <button class="provider-item${active}" type="button" data-provider-id="${escapeHtml(item.id)}">
        <span class="provider-dot ${statusClass}"></span>
        <span class="provider-name">
          ${escapeHtml(item.name)}
          <span class="provider-meta">${escapeHtml(caps || "provider")} - ${escapeHtml(item.status)} - ${installState} - ${modelCount} models - ${loaded} loaded</span>
        </span>
        <span class="badge">${item.manageable ? "manage" : "attach"}</span>
      </button>
    `;
  }).join("");

  if (!provider) {
    els.selectedProviderName.textContent = "No provider";
    els.selectedProviderMeta.textContent = "No providers configured";
    els.copyBaseBtn.disabled = true;
    els.startProviderBtn.disabled = true;
    els.endpointList.innerHTML = "";
    els.scanPanel.innerHTML = "";
    els.modelList.innerHTML = `<div class="empty">No providers configured.</div>`;
    return;
  }

  els.selectedProviderName.textContent = provider.name;
  els.selectedProviderMeta.textContent = `${provider.status} - ${provider.scan?.summary ?? provider.endpointUrl}`;
  const canStartProvider = canProviderStart(provider);
  els.startProviderBtn.disabled = !canStartProvider;
  els.startProviderBtn.dataset.providerId = provider.id;
  els.startProviderBtn.textContent = provider.status === "online"
    ? "Running"
    : (provider.id === "whisper" || provider.id === "huggingface" ? "Pick row" : "Start");
  const firstEndpoint = (provider.endpoints ?? [])[0]?.url;
  els.copyBaseBtn.disabled = !firstEndpoint;
  els.copyBaseBtn.dataset.endpoint = firstEndpoint ?? "";

  els.endpointList.innerHTML = (provider.endpoints ?? []).map((endpoint) => `
    <div class="endpoint-pill">
      <span>
        <span class="endpoint-label">${escapeHtml(endpoint.label)}</span>
        <span class="endpoint-url">${escapeHtml(endpoint.url)}</span>
      </span>
      <button class="button secondary copy-endpoint" type="button" data-endpoint="${escapeHtml(endpoint.url)}">Copy</button>
    </div>
  `).join("");

  const providerSignals = [
    ...(provider.scan?.signals ?? []).slice(0, 4),
    ...(provider.scan?.services ?? []).slice(0, 2).map((service) => ({
      kind: "service",
      label: `${service.scope}:${service.name}`,
      value: service.state,
    })),
    ...(provider.scan?.processes ?? []).slice(0, 2).map((process) => ({
      kind: "process",
      label: String(process.pid),
      value: process.command,
    })),
  ];
  const installedTools = tools.filter((tool) => tool.installed).slice(0, 8);

  els.scanPanel.innerHTML = `
    <div class="scan-block">
      <div class="scan-title">
        <span>Selected loader scan</span>
        <span class="badge">${provider.scan?.installed ? "installed" : "missing"}</span>
      </div>
      <div class="scan-summary">${escapeHtml(provider.scan?.summary ?? "No scan data")}</div>
      <div class="scan-chips">
        ${providerSignals.length ? providerSignals.map((signal) => `
          <span class="scan-chip installed" title="${escapeHtml(signal.value)}">${escapeHtml(signal.kind)}:${escapeHtml(signal.label)}</span>
        `).join("") : `<span class="scan-chip">No local signals</span>`}
      </div>
    </div>
    <div class="scan-block">
      <div class="scan-title">
        <span>Other AI tools</span>
        <span class="badge">${installedTools.length}</span>
      </div>
      <div class="scan-summary">${escapeHtml(installedTools.map((tool) => tool.name).join(", ") || "No extra tools detected")}</div>
      <div class="scan-chips">
        ${installedTools.map((tool) => `
          <span class="scan-chip installed" title="${escapeHtml(tool.summary)}">${escapeHtml(tool.name)}</span>
        `).join("") || `<span class="scan-chip">Nothing found</span>`}
      </div>
    </div>
  `;

  const loadedNames = new Set((provider.loadedModels ?? []).map((model) => model.name));
  const query = state.query.trim().toLowerCase();
  const models = (provider.installedModels ?? [])
    .filter((model) => !query || model.name.toLowerCase().includes(query))
    .filter((model) => matchesCapability(model, provider))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!models.length) {
    els.modelList.innerHTML = `<div class="empty">${provider.status === "online" ? "No matching models." : escapeHtml(provider.message ?? "Provider offline.")}</div>`;
    return;
  }

  els.modelList.innerHTML = models.map((model) => {
    const isLoaded = loadedNames.has(model.name);
    const loadedModel = (provider.loadedModels ?? []).find((item) => item.name === model.name);
    const action = rowAction(provider, model, isLoaded);
    const caps = modelCapabilities(model, provider).map(readableCapability).join("/");
    const targets = modelServeTargets(model).join(", ") || "catalog";
    const loadButton = `<button class="button ${action.className}" type="button" title="${escapeHtml(action.title)}" data-provider-id="${escapeHtml(provider.id)}" data-model="${escapeHtml(model.name)}" ${action.disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
    return `
      <div class="model-row">
        <span>
          <span class="model-name">${escapeHtml(model.name)}</span>
          <span class="model-meta">
            <span>${escapeHtml(caps)}</span>
            <span>${escapeHtml(model.family ?? model.modelFormat ?? "unknown")}</span>
            <span>${escapeHtml(targets)}</span>
            <span>${escapeHtml(formatBytes(model.sizeBytes))}</span>
          </span>
        </span>
        <span class="load-state ${isLoaded ? "loaded" : ""}">
          ${isLoaded ? `loaded ${escapeHtml(formatVramBytes(loadedModel?.vramBytes))}` : "idle"}
        </span>
        ${loadButton}
      </div>
    `;
  }).join("");
}

els.refreshBtn.addEventListener("click", () => loadSnapshot("refresh_state"));
els.clearLogBtn.addEventListener("click", () => {
  state.log = ["Ready."];
  els.actionLog.textContent = "Ready.";
});
els.modelSearch.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
els.providerList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-provider-id]");
  if (!item) return;
  state.selectedProviderId = item.dataset.providerId;
  render();
});
els.capabilityFilters.addEventListener("click", (event) => {
  const item = event.target.closest("[data-capability]");
  if (!item) return;
  state.capability = item.dataset.capability;
  render();
});
els.endpointList.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-endpoint");
  if (!button) return;
  copyEndpoint(button.dataset.endpoint);
});
els.copyBaseBtn.addEventListener("click", () => {
  if (els.copyBaseBtn.dataset.endpoint) copyEndpoint(els.copyBaseBtn.dataset.endpoint);
});
els.startProviderBtn.addEventListener("click", () => {
  if (els.startProviderBtn.dataset.providerId) startProvider(els.startProviderBtn.dataset.providerId);
});
els.modelList.addEventListener("click", (event) => {
  const loadButton = event.target.closest(".load-model");
  if (loadButton) {
    loadModel(loadButton.dataset.providerId, loadButton.dataset.model);
    return;
  }

  const unloadButton = event.target.closest(".unload-model");
  if (unloadButton) {
    unloadModel(unloadButton.dataset.providerId, unloadButton.dataset.model);
  }
});

if (tauri?.event?.listen) {
  tauri.event.listen("model-tray://refresh", () => loadSnapshot("refresh_state"));
}

loadSnapshot();
window.setInterval(() => loadSnapshot("refresh_state"), 5000);
