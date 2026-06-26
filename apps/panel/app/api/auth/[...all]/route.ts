// Better Auth catch-all handler (RESEARCH Pattern 1) — mounted ONLY in apps/panel (D-03).
//
// `toNextJsHandler(auth)` exposes every Better Auth endpoint (sign-up/in/out, session,
// organization plugin: invite/accept/setActive, ...) under /api/auth/*. apps/web is anon-only
// and deliberately has NO equivalent route (T-03-12). The runtime's nextCookies() plugin (last
// in the plugins array — Plan 03-01) sets the session cookie on these responses.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@imbau/api";

export const { GET, POST } = toNextJsHandler(auth);
