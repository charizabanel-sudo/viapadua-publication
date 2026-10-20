import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/generated/**",
    // Legacy PHP/HTML app — not yet migrated, not linted.
    "app.js",
    "css/**",
    "js/**",
    "uploads/**",
    "config/**",
    "includes/**",
  ]),
]);
