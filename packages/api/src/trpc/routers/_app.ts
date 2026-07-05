// appRouter (D-07) — the root tRPC router composing the minimal phase-3 procedure set:
//   projects.listForOrg / projects.listPublished
//   org.list / org.setActive
//   member.invite
//   invitation.accept
//   media.createUpload / media.confirmUpload
//   quotes.compute / quotes.create
//   picker.getPublishedProject / picker.listFloors / picker.listUnits / picker.listPlans
// AppRouter is the type the panel/web clients import for end-to-end type safety (no codegen).
import { router } from "../init";
import { projectsRouter } from "./projects";
import { orgRouter } from "./org";
import { memberRouter } from "./member";
import { invitationRouter } from "./invitation";
import { mediaRouter } from "./media";
import { quotesRouter } from "./quotes";
import { pickerRouter } from "./picker";

export const appRouter = router({
  projects: projectsRouter,
  org: orgRouter,
  member: memberRouter,
  invitation: invitationRouter,
  media: mediaRouter,
  quotes: quotesRouter,
  picker: pickerRouter,
});

export type AppRouter = typeof appRouter;
