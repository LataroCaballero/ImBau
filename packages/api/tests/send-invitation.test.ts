// Unit test for the dev console fallback of sendInvitationEmail (D-09, 03-VALIDATION Manual-Only
// note: real Resend delivery is staging-only; locally we assert the dev fallback logs the link).
//
// When RESEND_API_KEY is absent, sendInvitationEmail must NOT touch the network: it logs the
// /accept-invitation/[id] accept URL via console.info and returns. We assert exactly that. This
// is a pure unit test — it does NOT open a DB connection (only the auth env, which is already
// validated by the suite's required env), so it runs even when Postgres fixtures are unused.
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendInvitationEmail } from "../src/email/send-invitation";
import { env } from "../src/auth/env";

describe("invitation email fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the accept link to console.info when RESEND_API_KEY is absent", async () => {
    // The suite env intentionally leaves RESEND_API_KEY unset so the dev fallback fires.
    expect(env.RESEND_API_KEY).toBeUndefined();

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await sendInvitationEmail({
      id: "inv_123",
      email: "invitee@example.test",
      role: "viewer",
      organization: { name: "Acme" },
      inviter: { user: { name: "Owner Pérez" } },
    });

    expect(info).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls[0]?.[0] as string;
    // The accept URL points at the panel /accept-invitation/[id] route with the invitation id.
    expect(logged).toContain(`${env.BETTER_AUTH_URL}/accept-invitation/inv_123`);
    expect(logged).toContain("invitee@example.test");
    expect(logged).toContain("viewer");
    // No secret on the line.
    expect(logged).not.toContain("RESEND");
  });
});
