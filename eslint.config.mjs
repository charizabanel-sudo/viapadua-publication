import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "tmp/**",
    "public/pdf.worker.min.mjs",
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
