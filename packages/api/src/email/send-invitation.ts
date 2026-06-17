// Invitation email dispatch — STUB for plan 03-01 (D-09).
//
// Plan 03-03 replaces this with the real Resend + React Email implementation. For now the
// auth runtime needs a `sendInvitationEmail` callback that imports cleanly and is safe to run
// in tests and dev: it logs the accept link to the console (the D-09 dev fallback) and never
// reaches out to a network. The shape of `data` matches the org plugin's
// `sendInvitationEmail(data)` payload so the 03-03 swap is import-compatible.
import { env } from "../auth/env";

export interface InvitationEmailData {
  id: string;
  email: string;
  role: string;
  organization: { name: string };
  inviter: { user: { name: string } };
}

// Returns a Promise (not `async`) so the org plugin's `await sendInvitationEmail(data)` works
// and the 03-03 real (network) implementation is a drop-in swap — without an empty `await` in
// this no-I/O stub.
export function sendInvitationEmail(data: InvitationEmailData): Promise<void> {
  const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
  // Dev/test fallback (D-09): real Resend dispatch lands in plan 03-03. Logging the link is
  // intentional here — there are no secrets in the line (only the public accept URL).
  console.info(
    `[invite] ${data.email} -> ${data.organization.name} (${data.role}) :: ${acceptUrl}`,
  );
  return Promise.resolve();
}
