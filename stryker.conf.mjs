/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm", // we use bun but stryker's pm field is for its own internal npm ops
  reporters: ["clear-text", "html", "progress"],
  testRunner: "command",
  commandRunner: {
    // Focused run: mutate only these files, only run their tests. This
    // keeps the feedback loop fast enough to be useful (< 2 min).
    command: "bun test lib/tools/native/keysym.test.ts lib/tools/native/keysym.property.test.ts lib/tools/native/windows-host-client.test.ts lib/tools/native/windows-host-client.property.test.ts",
  },
  mutate: [
    "lib/tools/native/keysym.ts",
    "lib/tools/native/windows-host-client.ts",
  ],
  coverageAnalysis: "off",
  timeoutMS: 30_000,
  timeoutFactor: 2,
  // Stop after this many mutants survive — stops runaway runs when the
  // suite is obviously weak. Remove for exhaustive scoring.
  // maxTestRunnerReuse: 20,
  thresholds: {
    high: 80,
    low: 60,
    break: 0, // don't fail CI during initial baseline
  },
  tempDirName: ".stryker-tmp",
  htmlReporter: { fileName: ".stryker-tmp/reports/mutation/mutation.html" },
};
