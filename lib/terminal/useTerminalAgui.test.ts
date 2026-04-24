/**
 * Tests for the ANSI-stripping scraper used by the terminal AG-UI bridge.
 * The hook itself (React state) isn't covered here — this guards the
 * lossy-by-design text pipeline that the bridge forwards to the server.
 */

import { describe, expect, test } from "bun:test";
import { __TEST__ } from "./useTerminalAgui";

const { stripAnsi } = __TEST__;

describe("stripAnsi", () => {
  test("removes CSI SGR colour codes", () => {
    const input = "\x1b[31merror:\x1b[0m something went wrong";
    expect(stripAnsi(input)).toBe("error: something went wrong");
  });

  test("removes OSC window-title escapes terminated by BEL", () => {
    const input = "\x1b]0;claude — demo\x07actual output";
    expect(stripAnsi(input)).toBe("actual output");
  });

  test("removes CSI cursor-move sequences", () => {
    const input = "\x1b[2J\x1b[H\x1b[1;1Hhello";
    expect(stripAnsi(input)).toBe("hello");
  });

  test("keeps tabs and newlines", () => {
    const input = "line1\n\tindented\nline3";
    expect(stripAnsi(input)).toBe("line1\n\tindented\nline3");
  });

  test("strips bare control bytes but leaves printables intact", () => {
    const input = "hello\x00\x01 world\x7f!";
    expect(stripAnsi(input)).toBe("hello world!");
  });

  test("is a no-op on plain text", () => {
    const input = "just a line of text";
    expect(stripAnsi(input)).toBe(input);
  });

  test("strips a realistic claude-cli prompt render", () => {
    const input =
      "\x1b[2K\x1b[G\x1b[1m\x1b[38;5;39m>\x1b[0m what do you want\n\x1b[38;5;244m// press esc to interrupt\x1b[0m";
    const out = stripAnsi(input);
    expect(out).toContain("> what do you want");
    expect(out).toContain("// press esc to interrupt");
    expect(out).not.toContain("\x1b");
  });
});
