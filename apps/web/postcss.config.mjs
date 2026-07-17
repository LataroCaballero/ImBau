// Tailwind v4 PostCSS entry (D-10, RESEARCH Pattern 6). The single v4 plugin
// `@tailwindcss/postcss` folds in postcss-import + autoprefixer, so nothing else
// is needed here. Configuration is CSS-first via the `@theme` block in
// app/globals.css — there is intentionally NO tailwind.config.js.
export default { plugins: { "@tailwindcss/postcss": {} } };
