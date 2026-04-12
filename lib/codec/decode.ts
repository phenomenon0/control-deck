/**
 * GLYPH Decoder
 * Parses GLYPH format back to JSON-compatible values
 * 
 * Used for:
 * - UI inspectability (decode preview)
 * - Testing (round-trip verification)
 * - Developer tooling
 * 
 * NOT used in LLM runtime (LLM reads GLYPH directly)
 */

// =============================================================================
// Tokenizer
// =============================================================================

type TokenType =
  | "NULL"      // ∅
  | "TRUE"      // t
  | "FALSE"     // f
  | "NUMBER"    // 42, 3.14, -5e10
  | "STRING"    // "quoted" or bare-word
  | "LBRACKET"  // [
  | "RBRACKET"  // ]
  | "LPAREN"    // (
  | "RPAREN"    // )
  | "AT"        // @
  | "PIPE"      // |
  | "NEWLINE"   // \n
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

class Tokenizer {
  private input: string;
  private pos: number = 0;
  private peeked: Token | null = null;

  constructor(input: string) {
    this.input = input;
  }

  peek(): Token {
    if (this.peeked === null) {
      this.peeked = this.readToken();
    }
    return this.peeked;
  }

  next(): Token {
    if (this.peeked !== null) {
      const t = this.peeked;
      this.peeked = null;
      return t;
    }
    return this.readToken();
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private readToken(): Token {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { type: "EOF", value: "", pos: this.pos };
    }

    const startPos = this.pos;
    const ch = this.input[this.pos];

    // Single-char tokens
    switch (ch) {
      case "[": this.pos++; return { type: "LBRACKET", value: "[", pos: startPos };
      case "]": this.pos++; return { type: "RBRACKET", value: "]", pos: startPos };
      case "(": this.pos++; return { type: "LPAREN", value: "(", pos: startPos };
      case ")": this.pos++; return { type: "RPAREN", value: ")", pos: startPos };
      case "@": this.pos++; return { type: "AT", value: "@", pos: startPos };
      case "|": this.pos++; return { type: "PIPE", value: "|", pos: startPos };
      case "\n": this.pos++; return { type: "NEWLINE", value: "\n", pos: startPos };
      case "∅": this.pos++; return { type: "NULL", value: "∅", pos: startPos };
    }

    // Quoted string
    if (ch === '"') {
      return this.readQuotedString(startPos);
    }

    // Number or bare word
    return this.readBareOrNumber(startPos);
  }

  private readQuotedString(startPos: number): Token {
    this.pos++; // skip opening quote
    let value = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      if (ch === '"') {
        this.pos++; // skip closing quote
        return { type: "STRING", value, pos: startPos };
      }

      if (ch === "\\") {
        this.pos++;
        if (this.pos >= this.input.length) {
          throw new Error(`Unexpected end of input at position ${this.pos}`);
        }
        const escaped = this.input[this.pos];
        switch (escaped) {
          case "n": value += "\n"; break;
          case "r": value += "\r"; break;
          case "t": value += "\t"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          case "|": value += "|"; break;
          case "u":
            // Unicode escape \uXXXX
            if (this.pos + 4 >= this.input.length) {
              throw new Error(`Invalid unicode escape at position ${this.pos}`);
            }
            const hex = this.input.slice(this.pos + 1, this.pos + 5);
            value += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          default:
            value += escaped;
        }
      } else {
        value += ch;
      }
      this.pos++;
    }

    throw new Error(`Unterminated string starting at position ${startPos}`);
  }

  private readBareOrNumber(startPos: number): Token {
    let value = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      // Stop at delimiters
      if (" \t\r\n[]()@|\"".includes(ch)) break;
      value += ch;
      this.pos++;
    }

    if (value === "") {
      throw new Error(`Unexpected character at position ${startPos}: ${this.input[startPos]}`);
    }

    // Check for reserved words
    if (value === "t" || value === "true") {
      return { type: "TRUE", value, pos: startPos };
    }
    if (value === "f" || value === "false") {
      return { type: "FALSE", value, pos: startPos };
    }
    if (value === "null" || value === "none" || value === "nil") {
      return { type: "NULL", value, pos: startPos };
    }

    // Check if it's a number
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
      return { type: "NUMBER", value, pos: startPos };
    }

    // Bare string
    return { type: "STRING", value, pos: startPos };
  }
}

// =============================================================================
// Parser
// =============================================================================

class Parser {
  private tokenizer: Tokenizer;

  constructor(input: string) {
    this.tokenizer = new Tokenizer(input);
  }

  parse(): unknown {
    this.skipNewlines();
    const result = this.parseValue();
    this.skipNewlines();
    const next = this.tokenizer.peek();
    if (next.type !== "EOF") {
      throw new Error(`Unexpected token after value: ${next.type} at position ${next.pos}`);
    }
    return result;
  }

  /** Skip any newline tokens (for multiline support) */
  private skipNewlines(): void {
    while (this.tokenizer.peek().type === "NEWLINE") {
      this.tokenizer.next();
    }
  }

  private parseValue(): unknown {
    this.skipNewlines();
    const token = this.tokenizer.peek();

    switch (token.type) {
      case "NULL":
        this.tokenizer.next();
        return null;

      case "TRUE":
        this.tokenizer.next();
        return true;

      case "FALSE":
        this.tokenizer.next();
        return false;

      case "NUMBER":
        this.tokenizer.next();
        return parseFloat(token.value);

      case "STRING":
        this.tokenizer.next();
        return token.value;

      case "LBRACKET":
        return this.parseArray();

      case "AT":
        return this.parseStructOrTabular();

      default:
        throw new Error(`Unexpected token: ${token.type} at position ${token.pos}`);
    }
  }

  private parseArray(): unknown[] {
    this.tokenizer.next(); // consume [
    const items: unknown[] = [];

    while (true) {
      this.skipNewlines();
      const next = this.tokenizer.peek();
      if (next.type === "RBRACKET") {
        this.tokenizer.next();
        return items;
      }
      if (next.type === "EOF") {
        throw new Error("Unexpected end of input in array");
      }
      items.push(this.parseValue());
    }
  }

  private parseStructOrTabular(): unknown {
    this.tokenizer.next(); // consume @

    const next = this.tokenizer.peek();

    // Check for @tab (tabular)
    if (next.type === "STRING" && next.value === "tab") {
      return this.parseTabular();
    }

    // Check for @[ (packed struct)
    if (next.type === "LBRACKET") {
      return this.parsePackedStruct();
    }

    throw new Error(`Expected '[' or 'tab' after @, got ${next.type} at position ${next.pos}`);
  }

  private parsePackedStruct(): Record<string, unknown> {
    this.tokenizer.next(); // consume [

    // Parse keys (allow newlines between keys)
    const keys: string[] = [];
    while (true) {
      this.skipNewlines();
      const token = this.tokenizer.peek();
      if (token.type === "RBRACKET") {
        this.tokenizer.next();
        break;
      }
      if (token.type === "STRING") {
        this.tokenizer.next();
        keys.push(token.value);
      } else {
        throw new Error(`Expected key or ']', got ${token.type} at position ${token.pos}`);
      }
    }

    // Expect ( - allow newlines before it
    this.skipNewlines();
    const lparen = this.tokenizer.next();
    if (lparen.type !== "LPAREN") {
      throw new Error(`Expected '(' after keys, got ${lparen.type} at position ${lparen.pos}`);
    }

    // Parse values (allow newlines between values)
    const values: unknown[] = [];
    while (true) {
      this.skipNewlines();
      const token = this.tokenizer.peek();
      if (token.type === "RPAREN") {
        this.tokenizer.next();
        break;
      }
      if (token.type === "EOF") {
        throw new Error("Unexpected end of input in struct");
      }
      values.push(this.parseValue());
    }

    if (keys.length !== values.length) {
      throw new Error(`Key/value count mismatch: ${keys.length} keys, ${values.length} values`);
    }

    const result: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = values[i];
    }
    return result;
  }

  private parseTabular(): Record<string, unknown>[] {
    this.tokenizer.next(); // consume "tab"

    // Expect _ (anonymous table marker)
    let next = this.tokenizer.peek();
    if (next.type === "STRING" && next.value === "_") {
      this.tokenizer.next();
    }

    // Expect [columns]
    next = this.tokenizer.next();
    if (next.type !== "LBRACKET") {
      throw new Error(`Expected '[' for column list, got ${next.type} at position ${next.pos}`);
    }

    const columns: string[] = [];
    while (true) {
      const token = this.tokenizer.peek();
      if (token.type === "RBRACKET") {
        this.tokenizer.next();
        break;
      }
      if (token.type === "STRING") {
        this.tokenizer.next();
        columns.push(token.value);
      } else {
        throw new Error(`Expected column name or ']', got ${token.type}`);
      }
    }

    // Skip newline after header
    if (this.tokenizer.peek().type === "NEWLINE") {
      this.tokenizer.next();
    }

    // Parse rows
    const rows: Record<string, unknown>[] = [];

    while (true) {
      const token = this.tokenizer.peek();

      // Check for @end
      if (token.type === "AT") {
        this.tokenizer.next();
        const endToken = this.tokenizer.next();
        if (endToken.type === "STRING" && endToken.value === "end") {
          break;
        }
        throw new Error(`Expected 'end' after @, got ${endToken.type}`);
      }

      // Check for EOF
      if (token.type === "EOF") {
        throw new Error("Unexpected end of input in tabular data, expected @end");
      }

      // Skip newlines between rows
      if (token.type === "NEWLINE") {
        this.tokenizer.next();
        continue;
      }

      // Parse row: |val1|val2|val3|
      if (token.type === "PIPE") {
        const row = this.parseTabularRow(columns);
        rows.push(row);
      } else {
        throw new Error(`Expected '|' to start row, got ${token.type}`);
      }
    }

    return rows;
  }

  private parseTabularRow(columns: string[]): Record<string, unknown> {
    this.tokenizer.next(); // consume leading |

    const values: unknown[] = [];

    for (let i = 0; i < columns.length; i++) {
      // Read cell value (until next | or newline)
      const cellValue = this.readCellValue();
      values.push(cellValue);

      // Consume the | after this cell
      const pipe = this.tokenizer.peek();
      if (pipe.type === "PIPE") {
        this.tokenizer.next();
      }
    }

    // Skip trailing newline
    if (this.tokenizer.peek().type === "NEWLINE") {
      this.tokenizer.next();
    }

    const result: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      result[columns[i]] = values[i];
    }
    return result;
  }

  private readCellValue(): unknown {
    const token = this.tokenizer.peek();

    // Handle nested structures in cells
    if (token.type === "AT" || token.type === "LBRACKET") {
      return this.parseValue();
    }

    // Handle scalars
    switch (token.type) {
      case "NULL":
        this.tokenizer.next();
        return null;
      case "TRUE":
        this.tokenizer.next();
        return true;
      case "FALSE":
        this.tokenizer.next();
        return false;
      case "NUMBER":
        this.tokenizer.next();
        return parseFloat(token.value);
      case "STRING":
        this.tokenizer.next();
        return token.value;
      case "PIPE":
      case "NEWLINE":
        // Empty cell
        return null;
      default:
        throw new Error(`Unexpected token in cell: ${token.type}`);
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Decode GLYPH format to JSON-compatible value
 * 
 * @param glyph - GLYPH-encoded string
 * @returns Decoded value
 * @throws Error if parsing fails
 */
export function decodeGlyph(glyph: string): unknown {
  const trimmed = glyph.trim();
  if (trimmed === "") {
    return null;
  }
  const parser = new Parser(trimmed);
  return parser.parse();
}

/**
 * Try to decode GLYPH, return null on failure (for safe UI usage)
 */
export function tryDecodeGlyph(glyph: string): unknown | null {
  try {
    return decodeGlyph(glyph);
  } catch {
    return null;
  }
}

/**
 * Decode and return as pretty-printed JSON string (for UI preview)
 */
export function decodeGlyphToJson(glyph: string, indent = 2): string {
  const decoded = decodeGlyph(glyph);
  return JSON.stringify(decoded, null, indent);
}
