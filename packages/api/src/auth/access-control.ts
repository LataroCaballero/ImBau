// Access-control statement + the three domain roles owner/developer/viewer (AUTH-02, D-06).
//
// RESEARCH Pattern 2 + the Better Auth organization-plugin access-control contract: when you
// supply a CUSTOM `ac`/`roles`, the plugin's built-in permission checks still run against the
// plugin's OWN resources (`organization`/`member`/`invitation`/`team`/`ac`). For example
// `createInvitation` checks `invitation: ["create"]` on the inviter's role. So a custom
// statement MUST merge the plugin's `defaultStatements`, and each role must carry the plugin
// permissions it needs — otherwise an owner is "not allowed to invite". We add a domain
// `project` resource on top for the app's own authorization.
//
// These role NAMES map 1:1 onto `member.role`; the org creator resolves to "owner"
// (creatorRole default = "owner", verified in better-auth@1.6.18), and only "owner" carries
// `invitation:["create"]` so member.invite stays owner-only (D-12).
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Merge the org plugin's built-in statements with our domain `project` resource. Without the
// `...defaultStatements` spread, the plugin's invitation/member permission checks would have
// no matching statement and every owner action would be denied.
export const statement = {
  ...defaultStatements,
  project: ["read", "create", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

// owner: full control — manages the org, the membership roster, and invitations, plus full
// project control. Mirrors the plugin's built-in ownerAc so invite/accept/cancel work, and is
// the role the org creator receives.
export const owner = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  project: ["read", "create", "update", "delete"],
});

// developer: works on projects (no delete) and can read AC, but does NOT manage the roster or
// send invitations (invitation/member empty) — invites stay owner-only (D-12).
export const developer = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  project: ["read", "create", "update"],
});

// viewer: read-only on projects; no org/member/invitation powers. Suggested default invite role.
export const viewer = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  project: ["read"],
});
