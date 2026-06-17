// appRouter (D-07) — the root tRPC router composing the minimal phase-3 procedure set:
//   projects.listForOrg / projects.listPublished
//   org.list / org.setActive
//   member.invite
//   invitation.accept
// AppRouter is the type the panel/web clients import for end-to-end type safety (no codegen).
import { router } from "../init";
import { projectsRouter } from "./projects";
import { orgRouter } from "./org";
import { memberRouter } from "./member";
import { invitationRouter } from "./invitation";

export const appRouter = router({
  projects: projectsRouter,
  org: orgRouter,
  member: memberRouter,
  invitation: invitationRouter,
});

export type AppRouter = typeof appRouter;
