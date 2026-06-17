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
// Import the AC config from the dedicated subpath, NOT the package barrel: the barrel re-exports
// the server `auth` runtime, which transitively pulls `@imbau/db` + `postgres` (Node `fs`/`net`/
// `tls`) into the client bundle. access-control.ts is pure (only better-auth/plugins/access), so
// the client mirrors the same `ac`/roles without dragging the server graph into the browser.
import { ac, owner, developer, viewer } from "@imbau/api/access-control";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      ac,
      roles: { owner, developer, viewer },
    }),
  ],
});
