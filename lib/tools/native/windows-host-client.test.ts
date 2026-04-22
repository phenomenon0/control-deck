import { describe, expect, test } from "bun:test";
import { parseFrames } from "./windows-host-client";

function framed(body: string): Buffer {
  const b = Buffer.from(body, "utf8");
  const header = Buffer.from(`Content-Length: ${b.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, b]);
}

describe("parseFrames — happy paths", () => {
  test("single complete frame", () => {
    const { frames, remainder } = parseFrames(framed('{"id":1,"result":true}'));
    expect(frames).toEqual(['{"id":1,"result":true}']);
    expect(remainder.length).toBe(0);
  });

  test("two back-to-back frames in one buffer", () => {
    const buf = Buffer.concat([framed('{"id":1}'), framed('{"id":2}')]);
    const { frames, remainder } = parseFrames(buf);
    expect(frames).toEqual(['{"id":1}', '{"id":2}']);
    expect(remainder.length).toBe(0);
  });

  test("UTF-8 body with multibyte chars decodes correctly", () => {
    const body = '{"msg":"héllo 🙂 汉字"}';
    const { frames, remainder } = parseFrames(framed(body));
    expect(frames).toEqual([body]);
    expect(remainder.length).toBe(0);
  });

  test("Content-Length is case-insensitive", () => {
    const body = '{"ok":true}';
    const raw = Buffer.concat([
      Buffer.from(`content-length: ${Buffer.byteLength(body)}\r\n\r\n`, "ascii"),
      Buffer.from(body, "utf8"),
    ]);
    const { frames } = parseFrames(raw);
    expect(frames).toEqual([body]);
  });
});

describe("parseFrames — partial buffers (stream behavior)", () => {
  test("header-only buffer yields no frames, keeps remainder intact", () => {
    const raw = Buffer.from("Content-Length: 10\r\n\r\n", "ascii");
    const { frames, remainder } = parseFrames(raw);
    expect(frames).toEqual([]);
    expect(remainder.toString()).toBe("Content-Length: 10\r\n\r\n");
  });

  test("header + partial body — no frames, full buffer returned for accumulation", () => {
    const body = '{"id":1}';
    const raw = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
      Buffer.from(body.slice(0, 4), "utf8"),
    ]);
    const { frames, remainder } = parseFrames(raw);
    expect(frames).toEqual([]);
    expect(remainder.length).toBe(raw.length);
  });

  test("empty buffer — empty result, empty remainder", () => {
    const { frames, remainder } = parseFrames(Buffer.alloc(0));
    expect(frames).toEqual([]);
    expect(remainder.length).toBe(0);
  });

  test("one complete + one partial frame — first frame emitted, second remains as tail", () => {
    const first = '{"id":1}';
    const second = '{"id":2}';
    const partial = Buffer.concat([
      framed(first),
      Buffer.from(`Content-Length: ${second.length}\r\n\r\n`, "ascii"),
      Buffer.from(second.slice(0, 3), "utf8"),
    ]);
    const { frames, remainder } = parseFrames(partial);
    expect(frames).toEqual([first]);
    // The remainder must contain the full second header + partial body
    // so subsequent calls (after more bytes arrive) can complete it.
    expect(remainder.toString("utf8")).toContain("Content-Length: " + second.length);
  });
});

describe("parseFrames — malformed input", () => {
  test("header without Content-Length is skipped, subsequent frame still parses", () => {
    const good = '{"id":42}';
    const raw = Buffer.concat([
      Buffer.from("Garbage-Header: 123\r\n\r\n", "ascii"),
      framed(good),
    ]);
    const { frames, remainder } = parseFrames(raw);
    expect(frames).toEqual([good]);
    expect(remainder.length).toBe(0);
  });

  test("garbage in body is returned verbatim (json parse is caller's job)", () => {
    const { frames } = parseFrames(framed("not json at all"));
    expect(frames).toEqual(["not json at all"]);
  });
});
