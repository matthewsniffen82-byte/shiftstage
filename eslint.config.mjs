import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});

export default defineConfig([
  ...compat.config({
    extends: [
      "plugin:react/recommended",
      "plugin:react-hooks/recommended",
      "plugin:@next/next/recommended",
      "plugin:@next/next/core-web-vitals",
      "plugin:@typescript-eslint/recommended",
    ],
    plugins: ["import", "jsx-a11y"],
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  }),
  {
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-*/**",
    ".codex-remote-attachments/**",
    ".codex-worktrees/**",
    "work/**",
    "out/**",
    "build/**",
    "outputs/**",
    "next-env.d.ts",
  ]),
]);
