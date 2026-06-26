// A1 integration test — proves the Better Auth runtime boots against the phase-2 schema and
// that its OWNER-pool adapter actually WRITES the RLS-FORCED organization/member tables.
//
// These assertions are the phase's load-bearing gate (Pitfall 1): if the adapter used the
// unprivileged app pool, create-org / accept-invite would default-deny and no rows would land.
// The fixtures drive the REAL auth API (signup -> createOrganization -> setActiveOrganization),
// and a second signed-up user accepts an invitation, so the whole path is exercised end to end.
import { describe, it, expect, afterAll } from "vitest";
import { auth } from "../src/auth/runtime";
import { makeUserWithActiveOrg } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

// Replay a set-cookie value as a Cookie header (mirrors fixtures' helper, kept local to the test).
function cookies(setCookie: string | null): Headers {
  const h = new Headers();
  if (setCookie) {
    const pairs = setCookie
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter((c): c is string => Boolean(c));
    if (pairs.length > 0) h.set("cookie", pairs.join("; "));
  }
  return h;
}

describe("auth runtime (A1 owner pool)", () => {
  it("creating an organization writes an organization row and the creator is owner", async () => {
    const fx = await makeUserWithActiveOrg();

    // (a) the organization row landed (owner pool wrote an RLS-FORCED table)
    const orgRows = await owner`
      select id, slug from organization where id = ${fx.orgId}
    `;
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0]?.slug).toBe(fx.orgSlug);

    // (c) the creator's member row resolves to "owner" (creatorRole default — A3)
    const memberRows = await owner`
      select role from member where organization_id = ${fx.orgId} and user_id = ${fx.userId}
    `;
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.role).toBe("owner");
  });

  it("inviting a member and accepting writes a member row with the assigned role", async () => {
    const inviter = await makeUserWithActiveOrg();

    // Owner invites a new user as "developer".
    const invitation = await auth.api.createInvitation({
      body: {
        email: `invitee-${crypto.randomUUID()}@example.test`,
        role: "developer",
        organizationId: inviter.orgId,
      },
      headers: inviter.headers,
    });
    expect(invitation?.id).toBeTruthy();
    const inviteeEmail = invitation.email;

    // The invitee signs up (new user path, D-10), then accepts the invitation.
    const signUp = await auth.api.signUpEmail({
      body: {
        name: "Invitee",
        email: inviteeEmail,
        password: `Pw-${crypto.randomUUID()}`,
      },
      returnHeaders: true,
    });
    const inviteeId = signUp.response.user.id;
    const inviteeHeaders = cookies(signUp.headers.get("set-cookie"));

    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: inviteeHeaders,
    });

    // (b) a member row for the invitee exists with the assigned role.
    const memberRows = await owner`
      select role from member
      where organization_id = ${inviter.orgId} and user_id = ${inviteeId}
    `;
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.role).toBe("developer");
  });
});
