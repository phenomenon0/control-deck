import { describe, expect, test } from "bun:test";
import { createNotesCapabilities } from "./NotesPaneAdapter";

describe("NotesPaneAdapter capabilities", () => {
  test("read_text observes append_text and replace_text updates through the latest text source", () => {
    let text = "Initial notes";
    const capabilities = createNotesCapabilities({
      getText: () => text,
      setText: (next) => {
        text = typeof next === "function" ? next(text) : next;
      },
      getSelection: () => "",
    });

    expect(capabilities.read_text.handler()).toBe("Initial notes");
    expect(capabilities.append_text.handler({ text: "Macro smoke" })).toEqual({ appended: 11 });
    expect(capabilities.read_text.handler()).toBe("Initial notes\nMacro smoke");

    expect(capabilities.replace_text.handler({ text: "Replacement" })).toEqual({ length: 11 });
    expect(capabilities.read_text.handler()).toBe("Replacement");
  });
});
