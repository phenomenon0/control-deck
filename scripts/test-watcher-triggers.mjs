// Validate watcher event firing with a strong trigger: spawn a new
// process. This MUST fire WindowOpenedEvent.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
process.env.CONTROL_DECK_WIN_HOST = path.join(
  repo, "electron", "resources", "win", "WinAutomationHost.exe",
);
const { windowsUiaAdapter: a } = await import(
  path.join(repo, "lib", "tools", "native", "windows-uia.ts")
);

console.log("Installing permissive watcher (any window, any app)...");
const { watchId } = await a.watchInstall({
  match: {},           // match everything
  action: "notify",
  scope: "desktop",
  ttlMs: 30_000,
});
console.log("watchId:", watchId);

console.log("\nSpawning calc.exe...");
spawn("cmd.exe", ["/c", "start", "", "calc.exe"], { detached: true, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const drain = await a.watchDrain({ watchId });
console.log(`\nGot ${drain.events.length} events:`);
for (const e of drain.events.slice(0, 12)) {
  console.log(`  [${e.kind}] ${(e.element.role ?? "?").padEnd(10)} "${(e.element.name ?? "").slice(0, 50)}" (pid?)`);
}

await a.watchRemove({ watchId });
console.log(`\nremoved watcher`);

// Close calc
process.exit(0);
