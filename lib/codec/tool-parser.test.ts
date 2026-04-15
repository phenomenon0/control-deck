/**
 * GLYPH Tool Parser Tests
 * Run with: bun test lib/codec/tool-parser.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  parseGlyphToolCall,
  parseAllGlyphToolCalls,
  hasGlyphToolCall,
  parseTool,
} from "./tool-parser";

describe("parseGlyphToolCall", () => {
  test("parses simple tool call", () => {
    const text = `Tool{
      name = web_search
      args = @[query]("test query")
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool).not.toBeNull();
    expect(result.tool?.name).toBe("web_search");
    expect(result.tool?.args).toEqual({ query: "test query" });
  });

  test("parses compact inline tool call", () => {
    const text = `Tool{name=generate_image args=@[prompt width]("sunset" 1024)}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("generate_image");
    expect(result.tool?.args).toEqual({ prompt: "sunset", width: 1024 });
  });

  test("parses tool with multiple args", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code timeout](python "print('hello')" 30000)
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("execute_code");
    expect(result.tool?.args.language).toBe("python");
    expect(result.tool?.args.code).toBe("print('hello')");
    expect(result.tool?.args.timeout).toBe(30000);
  });

  test("extracts text before and after tool", () => {
    const text = `Let me search for that.

Tool{name=web_search args=@[query]("AI news")}

I'll analyze the results.`;
    
    const result = parseGlyphToolCall(text);
    expect(result.before.trim()).toBe("Let me search for that.");
    expect(result.after.trim()).toBe("I'll analyze the results.");
  });

  test("returns null tool for text without tool call", () => {
    const text = "Just some regular text without any tool calls.";
    const result = parseGlyphToolCall(text);
    expect(result.tool).toBeNull();
    expect(result.before).toBe(text);
  });
});

describe("parseAllGlyphToolCalls", () => {
  test("parses multiple tool calls", () => {
    const text = `
      Tool{name=web_search args=@[query]("first search")}
      Some text in between
      Tool{name=generate_image args=@[prompt]("mountain")}
      More text
      Tool{name=vector_store args=@[text collection]("save this" notes)}
    `;
    
    const tools = parseAllGlyphToolCalls(text);
    expect(tools.length).toBe(3);
    expect(tools[0].name).toBe("web_search");
    expect(tools[1].name).toBe("generate_image");
    expect(tools[2].name).toBe("vector_store");
  });

  test("returns empty array for no tools", () => {
    const text = "No tools here!";
    const tools = parseAllGlyphToolCalls(text);
    expect(tools.length).toBe(0);
  });
});

describe("hasGlyphToolCall", () => {
  test("detects tool call presence", () => {
    expect(hasGlyphToolCall("Tool{name=test args=@[]()}")).toBe(true);
    expect(hasGlyphToolCall("No tool here")).toBe(false);
    expect(hasGlyphToolCall("Tool{ incomplete")).toBe(false);
  });
});

describe("parseTool", () => {
  test("parses GLYPH tool call", () => {
    const text = `Tool{name=web_search args=@[query]("glyph format")}`;
    const tool = parseTool(text);
    expect(tool?.name).toBe("web_search");
    expect(tool?.args.query).toBe("glyph format");
  });

  test("returns null for non-GLYPH formats", () => {
    // JSON is NOT supported - GLYPH native only
    expect(parseTool('{"tool": "web_search", "args": {"query": "json"}}')).toBeNull();
    expect(parseTool("no tool here")).toBeNull();
  });

  test("extracts tool from surrounding text", () => {
    const text = `Let me search for that.
    
Tool{name=web_search args=@[query]("test")}

Here are the results.`;
    const tool = parseTool(text);
    expect(tool?.name).toBe("web_search");
  });
});

describe("edge cases", () => {
  test("handles nested objects in args (single-line)", () => {
    const text = `Tool{
      name = vector_store
      args = @[text metadata]("document content" @[source author](web "John Doe"))
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("vector_store");
    expect(result.tool?.args.text).toBe("document content");
    expect(result.tool?.args.metadata).toEqual({ source: "web", author: "John Doe" });
  });

  test("handles nested objects in args (multiline)", () => {
    const text = `Tool{
      name = vector_store
      args = @[text metadata](
        "document content"
        @[source author](web "John Doe")
      )
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("vector_store");
    expect(result.tool?.args.text).toBe("document content");
    expect(result.tool?.args.metadata).toEqual({ source: "web", author: "John Doe" });
  });

  test("handles arrays in args", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code args](bash "echo $1" ["hello" "world"])
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.args).toEqual(["hello", "world"]);
  });

  test("handles special characters in strings", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code](python "print('hello\\nworld')")
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.code).toContain("hello");
  });

  test("handles bare string values", () => {
    const text = `Tool{name=glyph_motif args=@[prompt style](protection sigil)}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.prompt).toBe("protection");
    expect(result.tool?.args.style).toBe("sigil");
  });

  test("handles boolean values", () => {
    const text = `Tool{name=glyph_motif args=@[prompt sheet](test t)}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.sheet).toBe(true);
  });

  test("handles null values", () => {
    const text = `Tool{name=test args=@[a b](hello ∅)}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.a).toBe("hello");
    expect(result.tool?.args.b).toBe(null);
  });

  test("handles numeric values", () => {
    const text = `Tool{name=generate_image args=@[prompt width height seed]("test" 1024 768 42)}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.args.width).toBe(1024);
    expect(result.tool?.args.height).toBe(768);
    expect(result.tool?.args.seed).toBe(42);
  });
});

describe("multiline support", () => {
  test("multiline args with simple values", () => {
    const text = `Tool{
      name = generate_image
      args = @[prompt width height](
        "a beautiful sunset over the ocean with waves"
        1024
        768
      )
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("generate_image");
    expect(result.tool?.args.prompt).toBe("a beautiful sunset over the ocean with waves");
    expect(result.tool?.args.width).toBe(1024);
    expect(result.tool?.args.height).toBe(768);
  });

  test("multiline args with nested arrays", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code args](
        bash
        "echo $1 $2"
        [
          hello
          world
        ]
      )
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("execute_code");
    expect(result.tool?.args.language).toBe("bash");
    expect(result.tool?.args.args).toEqual(["hello", "world"]);
  });

  test("deeply nested multiline structure", () => {
    const text = `Tool{
      name = complex_tool
      args = @[config](
        @[settings](
          @[inner](
            value
          )
        )
      )
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("complex_tool");
    expect(result.tool?.args.config).toEqual({
      settings: {
        inner: "value"
      }
    });
  });

  test("multiline code string", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code](python "def hello():
    print('Hello')
    return 42

result = hello()")
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("execute_code");
    expect(result.tool?.args.language).toBe("python");
    expect(result.tool?.args.code).toContain("def hello():");
    expect(result.tool?.args.code).toContain("return 42");
  });

  test("preserves formatting context around multiline tool", () => {
    const text = `Here's what I'll do:

Tool{
  name = web_search
  args = @[query max_results](
    "latest AI news"
    5
  )
}

Let me know if you need more results.`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("web_search");
    expect(result.before.trim()).toBe("Here's what I'll do:");
    expect(result.after.trim()).toBe("Let me know if you need more results.");
  });
});

describe("real-world examples", () => {
  test("generate image request", () => {
    const text = `I'll create that image for you.

Tool{
  name = generate_image
  args = @[prompt width height]("a majestic mountain landscape at sunset with snow-capped peaks" 1024 768)
}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("generate_image");
    expect(result.tool?.args.prompt).toContain("mountain landscape");
    expect(result.tool?.args.width).toBe(1024);
  });

  test("web search request", () => {
    const text = `Let me search for the latest information.

Tool{
  name = web_search
  args = @[query max_results]("latest AI developments December 2024" 5)
}`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("web_search");
    expect(result.tool?.args.max_results).toBe(5);
  });

  test("code execution request", () => {
    const text = `Tool{
      name = execute_code
      args = @[language code](python "
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(10):
    print(f'F({i}) = {fibonacci(i)}')
")
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("execute_code");
    expect(result.tool?.args.language).toBe("python");
    expect(result.tool?.args.code).toContain("fibonacci");
  });

  test("vector search with filter (single-line)", () => {
    const text = `Tool{
      name = vector_search
      args = @[query k mode filter]("machine learning tutorials" 10 hybrid @[source date](arxiv 2024))
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("vector_search");
    expect(result.tool?.args.k).toBe(10);
    expect(result.tool?.args.mode).toBe("hybrid");
    expect(result.tool?.args.filter).toEqual({ source: "arxiv", date: 2024 });
  });

  test("vector search with filter (multiline)", () => {
    const text = `Tool{
      name = vector_search
      args = @[query k mode filter](
        "machine learning tutorials"
        10
        hybrid
        @[source date](arxiv 2024)
      )
    }`;
    
    const result = parseGlyphToolCall(text);
    expect(result.tool?.name).toBe("vector_search");
    expect(result.tool?.args.k).toBe(10);
    expect(result.tool?.args.mode).toBe("hybrid");
    expect(result.tool?.args.filter).toEqual({ source: "arxiv", date: 2024 });
  });
});
