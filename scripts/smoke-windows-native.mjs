// Smoke-tests the Windows native adapter end-to-end:
//  - spawns the C# UIA sidecar via host-client
//  - calls locate() to exercise the UIA tree walk
//  - calls screenGrab() to exercise node-screenshots + base64 encoding
//  - calls key() via koffi/SendInput to exercise the FFI path
//  (key fires into thin air since we don't focus a target — just verifies
//  the SendInput call succeeds)

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
process.env.CONTROL_DECK_WIN_HOST = path.join(
  repo, "electron", "resources", "win", "WinAutomationHost.exe",
);

const { windowsUiaAdapter } = await import(
  path.join(repo, "lib", "tools", "native", "windows-uia.ts")
);

console.log("platform:", windowsUiaAdapter.platform);

console.log("\n[1] isAvailable");
console.log("    →", await windowsUiaAdapter.isAvailable?.());

console.log("\n[2] locate({role:'window', limit:3})");
const handles = await windowsUiaAdapter.locate({ role: "window", limit: 3 });
for (const h of handles) {
  console.log(`    → ${h.role} "${h.name}" [${h.id}]`);
}

console.log("\n[3] screenGrab");
const shot = await windowsUiaAdapter.screenGrab();
console.log(`    → ${shot.width}x${shot.height}, ${Math.round(shot.pngBase64.length * 3 / 4 / 1024)} KB PNG`);

console.log("\n[4] key('a') via SendInput — fires into whatever's focused");
await windowsUiaAdapter.key({ key: "a" });
console.log("    → SendInput returned");

console.log("\nok");
process.exit(0);
