// Test fixtures for @imbau/api — mint a real user + organization + ACTIVE session through the
// REAL Better Auth runtime (the owner-pool adapter, A1) — never a bypass.
//
// Downstream (plan 03-02) `protectedProcedure` tests need a session whose
// `activeOrganizationId` is set, created the same way production creates it. So this helper
// drives the actual auth API:
//   1. signUpEmail -> creates `user` + a session; we capture the session cookie from the
//      returned headers.
//   2. createOrganization (authenticated with that cookie) -> writes an `organization` row and
//      a creator `member` row (role = "owner", creatorRole default) through the OWNER pool.
//   3. setActiveOrganization -> sets `session.activeOrganizationId` (Pitfall 2: BA does not
//      auto-set it after signup).
// The returned `headers` carry the active-org session and are reusable by tRPC caller tests.
import { randomUUID } from "node:crypto";
import { auth } from "../src/auth/runtime";

export interface SessionFixture {
  userId: string;
  email: string;
  orgId: string;
  orgSlug: string;
  // A Headers object carrying the authenticated session cookie with the active org set.
  headers: Headers;
}

// Extract the auth session cookie(s) from a set-cookie header value into a Cookie header
// suitable for replaying on subsequent authenticated calls.
function cookieHeaderFrom(setCookie: string | null): Headers {
  const headers = new Headers();
  if (setCookie) {
    // set-cookie may contain multiple cookies; keep only the name=value pair of each.
    const pairs = setCookie
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter((c): c is string => Boolean(c));
    if (pairs.length > 0) headers.set("cookie", pairs.join("; "));
  }
  return headers;
}

// Create a fresh signed-up user with an active organization. `role` only affects later invites;
// the creator is always "owner" (creatorRole default).
export async function makeUserWithActiveOrg(): Promise<SessionFixture> {
  const tag = randomUUID().slice(0, 8);
  const email = `user-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;

  // 1. Sign up -> user + session. returnHeaders gives us the set-cookie to replay.
  const signUp = await auth.api.signUpEmail({
    body: { name: `User ${tag}`, email, password },
    returnHeaders: true,
  });
  const userId = signUp.response.user.id;
  const sessionHeaders = cookieHeaderFrom(signUp.headers.get("set-cookie"));

  // 2. Create an organization (authenticated). This is the A1 write: organization + creator
  //    member row land via the owner pool against RLS-FORCED tables.
  const orgSlug = `org-${randomUUID()}`;
  const created = await auth.api.createOrganization({
    body: { name: `Org ${tag}`, slug: orgSlug },
    headers: sessionHeaders,
  });
  if (!created) throw new Error("createOrganization returned no organization");
  const orgId = created.id;

  // 3. Set the active org on the session (Pitfall 2). Capture refreshed cookies if any.
  const activated = await auth.api.setActiveOrganization({
    body: { organizationId: orgId },
    headers: sessionHeaders,
    returnHeaders: true,
  });
  const refreshed = activated.headers.get("set-cookie");
  const headers = refreshed ? cookieHeaderFrom(refreshed) : sessionHeaders;

  return { userId, email, orgId, orgSlug, headers };
}
