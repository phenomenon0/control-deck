import { smartEncode, decodePayload, payloadSummary } from "../lib/agui/payload";

// Create data that GLYPH handles well - uniform object arrays with short values
const goodData = {
  items: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `item_${i + 1}`,
    active: i % 2 === 0,
    score: Math.round(Math.random() * 100),
    category: ["A", "B", "C"][i % 3],
    count: i * 10,
    enabled: true,
  })),
  total: 50,
  page: 1,
};

console.log("=== Testing GLYPH with favorable data ===\n");
console.log("JSON size:", JSON.stringify(goodData).length, "bytes");

const result = smartEncode(goodData, { minBytes: 500, minSavings: 5 });
console.log("\nResult:", payloadSummary(result));

if (result.kind === "glyph") {
  console.log("\nFirst 500 chars of GLYPH:");
  console.log(result.glyph.slice(0, 500));
  console.log("...\n");
  
  // Verify decode
  const decoded = decodePayload(result);
  const isValid = Array.isArray((decoded as any)?.items) && (decoded as any).items.length === 50;
  console.log("Decode valid:", isValid);
}
