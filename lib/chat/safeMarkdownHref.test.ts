import { describe, expect, test } from "bun:test";
import { safeMarkdownHref } from "./safeMarkdownHref";

describe("safeMarkdownHref", () => {
  test("allows http, https, mailto, and relative paths", () => {
    expect(safeMarkdownHref("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(safeMarkdownHref("http://example.com")).toBe("http://example.com/");
    expect(safeMarkdownHref("mailto:ops@example.com")).toBe("mailto:ops@example.com");
    expect(safeMarkdownHref("/api/upload/file-1")).toBe("/api/upload/file-1");
  });

  test("blocks script, data, protocol-relative, and malformed links", () => {
    expect(safeMarkdownHref("javascript:alert(1)")).toBeNull();
    expect(safeMarkdownHref("data:text/html,<svg onload=alert(1)>")).toBeNull();
    expect(safeMarkdownHref("//example.com/path")).toBeNull();
    expect(safeMarkdownHref("not a url")).toBeNull();
  });
});
