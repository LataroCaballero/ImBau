// Invitation email dispatch (D-09 / D-11, AUTH-03) — real Resend with a dev console fallback.
//
// This replaces the plan 03-01 console stub as a drop-in: same `InvitationEmailData` shape and
// the same `sendInvitationEmail(data): Promise<void>` signature the org plugin's
// `sendInvitationEmail(data)` callback awaits (packages/api/src/auth/runtime.ts).
//
// D-09: when `RESEND_API_KEY` is absent (local dev / tests) we log the accept link to the
// console and return — no network, zero external deps. The logged line carries only the public
// accept URL, never a secret (V7). When the key IS present (staging/prod), we render the es-AR
// React Email template and send it via Resend from the verified `INVITE_FROM` sender.
import { Resend } from "resend";
import { env } from "../auth/env";
import { InvitationEmail } from "./templates/invitation";

export interface InvitationEmailData {
  id: string;
  email: string;
  role: string;
  organization: { name: string };
  inviter: { user: { name: string } };
}

export async function sendInvitationEmail(
  data: InvitationEmailData,
): Promise<void> {
  const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
  const inviter = data.inviter.user.name;
  const orgName = data.organization.name;

  // Dev/test fallback (D-09): no Resend key -> log the accept link and stop. The link is the
  // only thing on the line (no secret), so it is safe to log.
  if (!env.RESEND_API_KEY) {
    console.info(
      `[invite] ${data.email} -> ${orgName} (${data.role}) :: ${acceptUrl}`,
    );
    return;
  }

  // Staging/prod: render the es-AR template and send via Resend. INVITE_FROM must be a verified
  // sender on the Resend account; it is required only once a key is present.
  if (!env.INVITE_FROM) {
    throw new Error(
      "INVITE_FROM must be set when RESEND_API_KEY is present (verified Resend sender).",
    );
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.INVITE_FROM,
    to: data.email,
    subject: `Te invitaron a ${orgName}`,
    react: InvitationEmail({ acceptUrl, orgName, inviter }),
  });
  if (error) {
    // Surface the failure (observable, never silently swallowed — CLAUDE.md). The message is
    // Resend's own error, which does not include our API key.
    throw new Error(`Resend failed to send the invitation: ${error.message}`);
  }
}
