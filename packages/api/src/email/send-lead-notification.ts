// New-lead notification dispatch (D-07, LEADS-04) — real Resend with a dev console fallback.
//
// Called by the fase-11 worker processor (apps/worker/src/lead-email.ts, Plan 04) through the
// `@imbau/api/email` subpath export — NOT by the tRPC router. The email SEND lives in the
// worker so a slow/failing Resend never blocks the `leads.create` request; the enqueue seam
// (Plan 03) only pushes the job.
//
// D-09: when `RESEND_API_KEY` is absent (local dev / tests) we log a one-line lead summary to
// the console and return — no network, zero external deps. The logged line carries only the
// public lead summary (to / nombre / origen), NEVER a secret (T-11-03 / V7). When the key IS
// present (staging/prod), we render the es-AR React Email template and send it via Resend from
// the verified `INVITE_FROM` sender (T-11-04).
import { createEnv } from "@t3-oss/env-core";
import { Resend } from "resend";
import { authEnv, baseEnv } from "@imbau/config/env/presets";
import { LeadNotificationEmail } from "./templates/lead-notification";

// Dedicated MINIMAL env for this dispatch (T-11-03). It composes ONLY the transactional-email
// vars plus the panel base URL — it deliberately does NOT reuse the auth runtime's env module,
// which composes BETTER_AUTH_SECRET + the owner DATABASE_URL. The worker imports THIS module;
// reusing that env would force those elevated secrets onto the worker for no reason. BETTER_AUTH_URL (the
// panel base URL the worker uses to build the bandeja deep-link) is declared here so a worker
// missing it fails loudly at import with the variable NAME — never the value (t3-env's default
// formatter prints NAME only), mirroring the webEnv/deep-link precedent.
const env = createEnv({
  server: {
    ...baseEnv.server,
    RESEND_API_KEY: authEnv.server.RESEND_API_KEY, // dev console fallback when absent (D-09)
    INVITE_FROM: authEnv.server.INVITE_FROM, // verified Resend sender; required with a key
    BETTER_AUTH_URL: authEnv.server.BETTER_AUTH_URL, // panel base URL (worker deep-link origin)
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});

// The rendered content of a new-lead notification. IDS/secrets never appear here — the worker
// resolves these public fields under RLS before calling us. `deepLink` is the fully-qualified
// bandeja URL the worker built from its own panel base URL.
export interface LeadNotificationData {
  to: string;
  nombre: string;
  contacto: string;
  origen: string;
  projectNombre: string;
  deepLink: string;
}

export async function sendLeadNotification(
  data: LeadNotificationData,
): Promise<void> {
  const { to, nombre, contacto, origen, projectNombre, deepLink } = data;

  // Dev/test fallback (D-09): no Resend key -> log the public lead summary and stop. Only the
  // recipient + nombre + origen are on the line (no secret), so it is safe to log (T-11-03).
  if (!env.RESEND_API_KEY) {
    console.info(`[lead] ${to} :: ${nombre} — ${origen}`);
    return;
  }

  // Staging/prod: render the es-AR template and send via Resend. INVITE_FROM must be a verified
  // sender on the Resend account; it is required only once a key is present (T-11-04).
  if (!env.INVITE_FROM) {
    throw new Error(
      "INVITE_FROM must be set when RESEND_API_KEY is present (verified Resend sender).",
    );
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.INVITE_FROM,
    to,
    subject: `Tenés un lead nuevo en ${projectNombre}`,
    react: LeadNotificationEmail({
      nombre,
      contacto,
      origen,
      projectNombre,
      deepLink,
    }),
  });
  if (error) {
    // Surface the failure (observable, never silently swallowed — CLAUDE.md). The message is
    // Resend's own error, which does not include our API key (T-11-03).
    throw new Error(`Resend failed to send the lead notification: ${error.message}`);
  }
}
