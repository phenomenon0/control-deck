import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const migratedNextVitals = nextVitals.map((config) =>
  config.name === "next"
    ? {
        ...config,
        rules: {
          ...config.rules,
          "react/no-unescaped-entities": "warn",
          "react-hooks/set-state-in-effect": "warn",
          "react-hooks/static-components": "warn",
          "react-hooks/preserve-manual-memoization": "warn",
          "react-hooks/purity": "warn",
          "react-hooks/refs": "warn",
        },
      }
    : config,
);

export default defineConfig([
  ...migratedNextVitals,
  globalIgnores([
    ".electron-dist/**",
    ".next/**",
    ".turbo/**",
    ".venv*/**",
    "apps/model-tray/src-tauri/target/**",
    "build/**",
    "coverage/**",
    "dist/**",
    "dist-electron/**",
    "llama.cpp/**",
    "node_modules/**",
    "out/**",
  ]),
]);
