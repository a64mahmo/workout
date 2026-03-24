import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Disable specific rules that are overly aggressive for our use cases
  {
    rules: {
      "react-hooks/rules-of-hooks": "off", // Disables all rules related to rules of hooks
      "react-hooks/exhaustive-deps": "off", // Disables rules related to exhaustive-deps
      "react-hooks/set-state-in-effect": "off", // Specifically target the problematic rule
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
