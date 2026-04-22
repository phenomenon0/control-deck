import { describe, expect, test } from "bun:test";
import { parseNvidiaSmiOutput } from "./gpu-processes";

describe("parseNvidiaSmiOutput", () => {
  test("returns empty for empty stdout", () => {
    expect(parseNvidiaSmiOutput("")).toEqual([]);
  });

  test("parses three columns in CSV", () => {
    const out = "12345, /usr/local/bin/ollama, 4096\n23456, python3.11, 8192\n";
    const rows = parseNvidiaSmiOutput(out);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      pid: 12345,
      processName: "/usr/local/bin/ollama",
      usedMemoryMb: 4096,
      providerHint: "ollama",
    });
    expect(rows[1].providerHint).toBe("pytorch");
  });

  test("skips malformed lines", () => {
    const out = "only-two,fields\nnot,even,numeric\n99,ok,512\n";
    const rows = parseNvidiaSmiOutput(out);
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe(99);
  });

  test("hints cover every major provider family", () => {
    const out = [
      "1, /opt/vllm/bin/vllm, 10000",
      "2, llama-server, 4000",
      "3, LM Studio Helper, 8000",
      "4, ComfyUI.exe, 2000",
      "5, whisper.cpp, 512",
      "6, piper, 64",
      "7, /random/binary, 200",
    ].join("\n");
    const rows = parseNvidiaSmiOutput(out);
    expect(rows.map((r) => r.providerHint)).toEqual([
      "vllm",
      "llamacpp",
      "lm-studio",
      "comfyui",
      "whisper",
      "piper",
      "other",
    ]);
  });
});
