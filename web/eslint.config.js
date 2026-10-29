import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "public/app.js",
      "coverage",
      "playwright-report",
      "test-results",
      ".wrangler",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.client.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Interdit (XSS / Trusted Types) : utiliser h() ou textContent." },
        { property: "outerHTML", message: "Interdit (XSS / Trusted Types)." },
        { property: "insertAdjacentHTML", message: "Interdit (XSS / Trusted Types)." },
      ],
      "no-restricted-syntax": ["error", { selector: "CallExpression[callee.name='eval']", message: "eval interdit." }],
    },
  },
  { files: ["src/client/**", "e2e/**"], languageOptions: { globals: globals.browser } },
  {
    files: ["test/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  { files: ["eslint.config.js", "scripts/**/*.mjs"], ...tseslint.configs.disableTypeChecked },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
);
