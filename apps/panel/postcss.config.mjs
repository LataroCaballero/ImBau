// Tailwind v4 PostCSS entry (10-UI-SPEC §Wiring, mirrors apps/web). The single v4
// plugin `@tailwindcss/postcss` folds in postcss-import + autoprefixer, so nothing
// else is needed here. Configuration is CSS-first via the `@theme` block in
// app/globals.css — there is intentionally NO tailwind.config.js.
export default { plugins: { "@tailwindcss/postcss": {} } };
