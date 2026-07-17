import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Shared ESLint 9 flat config for the whole monorepo (MONO-02, D-11).
// `projectService: true` is the monorepo-friendly replacement for per-package
// `project` arrays; it keeps type-aware rules firing without "file not found in
// any project" errors (Pitfall 2). `prettier` (eslint-config-prettier) MUST be
// last so it disables the stylistic rules Prettier owns.
export const config = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      // Coverage reports are generated artifacts (gitignored); never lint them.
      "**/coverage/**",
      // PostCSS config (Tailwind v4 entry) is a plain config file outside any
      // tsconfig project, so `projectService` type-aware linting cannot resolve
      // it ("not found by the project service"). Config files carry no app logic
      // to type-lint — exclude them like the other non-source artifacts above.
      "**/postcss.config.mjs",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  prettier,
);
