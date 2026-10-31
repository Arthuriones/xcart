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
    "tema/**",
    // Worktrees de agente carregam uma copia inteira do repo (inclusive
    // tema/assets com jquery vendorizado). Sem ignorar, o lint reporta 23
    // erros que nao existem no codigo de verdade e ninguem olha mais o lint.
    ".claude/**",
    "**/.claude/**",
    "public/Combo bot/**",
    "failed_html.html",
    "herocart.html",
    // O app do celular (Expo) tem lint proprio (npx expo lint dentro de mobile/).
    "mobile/**",
  ]),
]);

export default eslintConfig;
