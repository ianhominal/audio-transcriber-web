import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `.claude/` es tooling local gitignoreado (docs, bundles de handoff de Claude Design con su
    // runtime compilado). No es código del proyecto — no se lintea ni se deploya.
    ".claude/**",
  ]),
]);

export default eslintConfig;
