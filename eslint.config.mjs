import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The desktop shell's main process and build config are CommonJS
  {
    files: ["electron/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local tooling dir (gitignored); its ACLs can be unreadable after an OS reinstall
    ".gstack/**",
    // Desktop build output: the staged server bundle and the packaged app
    "electron/stage/**",
    "electron/dist/**",
  ]),
]);

export default eslintConfig;
