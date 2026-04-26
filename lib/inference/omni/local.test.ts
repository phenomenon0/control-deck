import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  getQwenOmniStatus,
  getQwenOmniStatusAsync,
  probeQwenOmniSidecar,
  qwenOmniBinding,
  qwenOmniSidecarUrl,
  QWEN_OMNI_MODEL_ID,
  QWEN_OMNI_PROVIDER_ID,
} from "./local";

let tempDir: string;

describe("qwen omni local status", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-omni-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("reports missing snapshot clearly", () => {
    const status = getQwenOmniStatus({
      modelDir: path.join(tempDir, "missing"),
      minWeightBytes: 1,
    });

    expect(status.installed).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.issues[0]).toContain("Missing model directory");
  });

  test("accepts a complete minimal AWQ snapshot", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        model_type: "qwen2_5_omni",
        enable_audio_output: true,
        quantization_config: { quant_method: "awq", bits: 4 },
      }),
    );
    fs.writeFileSync(path.join(tempDir, "tokenizer.json"), "{}");
    fs.writeFileSync(path.join(tempDir, "preprocessor_config.json"), "{}");
    fs.writeFileSync(path.join(tempDir, "model-00001-of-00001.safetensors"), "1234567890");
    fs.writeFileSync(
      path.join(tempDir, "model.safetensors.index.json"),
      JSON.stringify({ metadata: { total_size: 10 }, weight_map: {} }),
    );

    const status = getQwenOmniStatus({ modelDir: tempDir, minWeightBytes: 10 });

    expect(status.ready).toBe(true);
    expect(status.shardCount).toBe(1);
    expect(status.hasAwqQuantization).toBe(true);
    expect(status.audioOutputEnabled).toBe(true);
  });

  test("binding targets the shared provider across modalities", () => {
    const binding = qwenOmniBinding("stt", "/models/qwen");

    expect(binding.providerId).toBe(QWEN_OMNI_PROVIDER_ID);
    expect(binding.config.model).toBe(QWEN_OMNI_MODEL_ID);
    expect(binding.config.baseURL).toBe("/models/qwen");
    expect(binding.config.extras?.e2eVoiceAssistant).toBe(true);
  });
});

describe("qwen omni sidecar plumbing", () => {
  const previousEnv = process.env.OMNI_SIDECAR_URL;
  const realFetch = globalThis.fetch;

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.OMNI_SIDECAR_URL;
    else process.env.OMNI_SIDECAR_URL = previousEnv;
    globalThis.fetch = realFetch;
  });

  test("returns null when env unset", () => {
    delete process.env.OMNI_SIDECAR_URL;
    expect(qwenOmniSidecarUrl()).toBeNull();
  });

  test("strips trailing slashes", () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000///";
    expect(qwenOmniSidecarUrl()).toBe("http://omni-host:9000");
  });

  test("status reflects configured sidecar without probing", () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000";
    const status = getQwenOmniStatus();
    expect(status.sidecar.configured).toBe(true);
    expect(status.sidecar.baseURL).toBe("http://omni-host:9000");
    expect(status.sidecar.reachable).toBeNull();
  });

  test("probeQwenOmniSidecar marks reachable when /health returns 200", async () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ model: "Qwen2.5-Omni-7B-AWQ" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const sidecar = await probeQwenOmniSidecar();
    expect(sidecar.configured).toBe(true);
    expect(sidecar.reachable).toBe(true);
    expect(sidecar.detail).toContain("Qwen2.5-Omni-7B-AWQ");
  });

  test("probeQwenOmniSidecar marks unreachable on network error", async () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000";
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const sidecar = await probeQwenOmniSidecar();
    expect(sidecar.reachable).toBe(false);
    expect(sidecar.detail).toContain("connection refused");
  });

  test("getQwenOmniStatusAsync without probeSidecar skips fetch", async () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("");
    }) as unknown as typeof fetch;
    const status = await getQwenOmniStatusAsync();
    expect(calls).toBe(0);
    expect(status.sidecar.configured).toBe(true);
  });

  test("binding includes the sidecar URL when configured", () => {
    process.env.OMNI_SIDECAR_URL = "http://omni-host:9000/";
    const binding = qwenOmniBinding("tts", "/models/qwen");
    expect(binding.config.extras?.sidecarUrl).toBe("http://omni-host:9000");
  });
});
