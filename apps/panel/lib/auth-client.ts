// Better Auth client for the panel (RESEARCH Pattern 2 note, Pattern 5).
//
// The client mirrors the SERVER's access-control config so client-side permission checks agree
// with the server: it imports the very same `ac` + owner/developer/viewer roles from @imbau/api
// (the single source of truth — packages/api/src/auth/access-control.ts) and passes them to the
// `organizationClient` plugin. Exposes `authClient.signIn.email` / `signUp.email` and the
// organization sub-client (`organization.acceptInvitation` / `setActive`, etc.) used by the
// login / signup / accept-invitation pages.
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, owner, developer, viewer } from "@imbau/api";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      ac,
      roles: { owner, developer, viewer },
    }),
  ],
});
