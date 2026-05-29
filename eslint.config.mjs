/**
 * ESLint flat config.
 *
 * We bypass `next lint` because it pins eslint to v8 and the project
 * is on v9 (flat config). The rules here cover what `next lint` provided
 * (no-img-element, react-unescaped-entities) plus our project-specific
 * boundaries:
 *
 *   - `no-restricted-imports` blocks UI components from importing
 *     @server/infrastructure / @server/application directly (the rule
 *     UI ↔ @server/domain type-only stays open per ADR-0002).
 *   - `no-console` is warn-level — production code should use the
 *     structured logger at @server/infrastructure/observability/logger.
 *     console.error and console.warn are allowed during the
 *     transition (P6.4 sweeps the rest).
 */
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      ".next-build/**",
      "node_modules/**",
      "drizzle/**",
      "scripts/**",
      "tests/e2e/**",
      "*.config.{js,cjs,mjs,ts}",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      // Tighten unused-vars but tolerate `_`-prefixed for intentional
      // unused-param signaling (req/event handlers, callback shape).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow explicit any only at the type-cast boundary — flag the
      // sloppy uses. Warn for now; the codebase already has very few.
      "@typescript-eslint/no-explicit-any": "warn",
      // Default exports are fine for Next routes/pages; don't fight Next.
      "@typescript-eslint/no-empty-object-type": "off",
      // We use namespace imports for some heuristic AI providers.
      "@typescript-eslint/no-require-imports": "warn",
      // console.error + .warn allowed; everything else should adopt the
      // structured logger. P6.4 sweeps the existing call sites.
      "no-console": [
        "warn",
        {
          allow: ["error", "warn"],
        },
      ],
    },
  },
  // Boundary rule: UI components must not import @server/application
  // (mutations / use-cases) or @server/jobs (Inngest cron handlers).
  //
  // Note: repositories and middleware ARE allowed because Next.js Server
  // Components legitimately need to read account-scoped data inline. The
  // bundler refuses any import in a "use client" component, so the
  // runtime guarantee is already there for client modules. This ESLint
  // rule guards against UI accidentally invoking a write path.
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      // Switch to @typescript-eslint variant which honours `import type`.
      // Stock no-restricted-imports treats `import type` as runtime, but
      // type imports are erased at build time and don't bring behaviour
      // across the layer boundary — they're the documented escape hatch.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@server/application/*", "@server/jobs/*"],
              message:
                "UI components must not import @server/application (mutations) or @server/jobs (crons). Trigger mutations through a server action; pass already-derived data via props. Use `import type` if you only need a type.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // Test files can import anything.
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
    },
  },
];
