import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "deck.db"));
const rows = db.prepare("SELECT data FROM events WHERE type = 'ToolCallResult' ORDER BY id DESC LIMIT 3").all() as { data: string }[];

console.log("\n=== Last 3 ToolCallResult Events ===\n");
for (const row of rows) {
  const data = JSON.parse(row.data);
  console.log("result.kind:", data.result?.kind);
  if (data.result?.kind === "glyph") {
    console.log("  GLYPH length:", data.result.glyph?.length, "chars");
    console.log("  approxBytes:", data.result.approxBytes);
    const savings = ((1 - data.result.glyph.length / data.result.approxBytes) * 100).toFixed(1);
    console.log("  savings:", savings + "%");
  } else if (data.result?.kind === "json") {
    const jsonStr = JSON.stringify(data.result.data);
    console.log("  JSON size:", jsonStr.length, "bytes");
    console.log("  (GLYPH threshold: 2000 bytes)");
  }
  console.log("");
}
db.close();
