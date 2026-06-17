// The Better Auth RUNTIME (D-01) — promotes the CLI-only config in `packages/db/auth.ts`
// into a real runtime, adding email/password, baseURL/secret, the access-control roles, the
// invitation email callback, and `nextCookies()`. The Drizzle table shape is NOT redefined
// here: we reuse the SAME `organization({ schema: { organization: { additionalFields: { plan } } } })`
// block verbatim so the runtime never diverges from the phase-2 generated schema.
//
// === A1 — THE load-bearing decision (RESEARCH Pitfall 1) ===
// The Better Auth Drizzle adapter writes `organization`/`member`/`session`/`user`/`account`/
// `invitation`. `organization` and `member` are RLS-FORCED (phase 2) and the application
// pools (`app_authenticated`/`anon`) cannot satisfy those policies before any tenant GUC is
// set — so creating an org / accepting an invite on the app pool would DEFAULT-DENY the write.
// We therefore give the adapter the ELEVATED owner pool via `createOwnerDb(env.DATABASE_URL)`,
// which owns the tables and may write auth/org bookkeeping freely. The application data path
// (tRPC routers, plan 03-02) stays on `withTenant`/`withAnon` — this file intentionally does
// NOT import `appDb`/`anonDb`/`withTenant`/`withAnon` so the elevated pool cannot leak into a
// router (T-03-01/T-03-02). The auth-runtime integration test proves org-create + invite-accept
// actually write rows through this pool.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { createOwnerDb } from "@imbau/db";
import { ac, owner, developer, viewer } from "./access-control";
import { sendInvitationEmail } from "../email/send-invitation";
import { env } from "./env";

// Elevated/owner pool — NOT appDb. See the A1 note above.
const { db } = createOwnerDb(env.DATABASE_URL);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  // D-04: no email-verification gate this phase; signup -> login is frictionless.
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  plugins: [
    organization({
      ac,
      roles: { owner, developer, viewer },
      // creatorRole defaults to "owner" in 1.6.18 (verified in the crud-org route), and
      // "owner" is in our role set, so the org creator resolves to owner without an override.
      // Same additionalFields.plan block as packages/db/auth.ts — schema does not diverge.
      schema: {
        organization: {
          additionalFields: { plan: { type: "string", required: false } },
        },
      },
      async sendInvitationEmail(data) {
        await sendInvitationEmail(data);
      },
    }),
    // MUST be last (RESEARCH Pitfall 3): nextCookies() hooks cookie-setting for Next server
    // actions; if any plugin follows it, login cookies are not set on the server-action path.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
