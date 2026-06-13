import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Shared ESLint 9 flat config for the whole monorepo (MONO-02, D-11).
// `projectService: true` is the monorepo-friendly replacement for per-package
// `project` arrays; it keeps type-aware rules firing without "file not found in
// any project" errors (Pitfall 2). `prettier` (eslint-config-prettier) MUST be
// last so it disables the stylistic rules Prettier owns.
export const config = tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/node_modules/**"],
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
