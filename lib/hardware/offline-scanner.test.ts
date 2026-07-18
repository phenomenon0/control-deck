import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanOffline } from "./offline-scanner";

describe("offline scanner configured model roots", () => {
  let root: string;
  let previousRoots: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-offline-models-"));
    previousRoots = process.env.DECK_GGUF_DIRS;
    process.env.DECK_GGUF_DIRS = root;
  });

  afterEach(() => {
    if (previousRoots === undefined) delete process.env.DECK_GGUF_DIRS;
    else process.env.DECK_GGUF_DIRS = previousRoots;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("finds GGUF and common checkpoint formats", () => {
    const weights = path.join(root, "comfy", "models");
    fs.mkdirSync(weights, { recursive: true });
    const gguf = path.join(weights, "example-Q4_K_M.gguf");
    const safetensors = path.join(weights, "example.safetensors");
    fs.writeFileSync(gguf, "gguf");
    fs.writeFileSync(safetensors, "weights");

    const result = scanOffline();

    expect(result.models.find((model) => model.path === gguf)?.source).toBe("gguf");
    expect(result.models.find((model) => model.path === safetensors)?.source).toBe("model-file");
  });

  test("recognizes a configured Ollama store", () => {
    const manifest = path.join(
      root,
      "models",
      "manifests",
      "registry.ollama.ai",
      "library",
      "external-model",
      "latest",
    );
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, "{}");

    const result = scanOffline();
    const found = result.models.find((model) => model.path === manifest);

    expect(found?.source).toBe("ollama-manifest");
    expect(found?.name).toBe("external-model:latest");
  });
});
