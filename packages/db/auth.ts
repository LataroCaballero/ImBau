// Minimal Better Auth config — used ONLY by @better-auth/cli generate (D-03).
//
// This file has NO runtime: no baseURL, no endpoints, no UI. Its sole purpose is to
// give `@better-auth/cli@1.4.21 generate` enough config to emit the Drizzle Postgres
// table shapes for the organization plugin, which we then fold into the versioned
// Drizzle schema (one migration history — CLAUDE.md "fold Better Auth schema into
// Drizzle"). The real auth runtime (better-auth@1.6.18) is wired in phase 3 and reuses
// this same config; the CLI's Kysely-only `migrate` subcommand is NEVER run here.
//
// D-01: the `organization` table is the canonical tenant, extended with a `plan`
// column (additionalFields below) so the generated schema carries it.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  // No db instance is needed for `generate` — the CLI only reads this config to emit
  // schema text. `provider: "pg"` selects the Drizzle Postgres generator output.
  database: drizzleAdapter({}, {
    provider: "pg",
  }),
  plugins: [
    organization({
      // D-01: emit a `plan` column on `organization` (optional string; refine later if needed).
      schema: {
        organization: {
          additionalFields: {
            plan: { type: "string", required: false },
          },
        },
      },
    }),
  ],
});
