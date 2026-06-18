// Dashboard RSC (APP-01 / AUTH-02, D-15) — the panel's authenticated home at `/`.
//
// Reads the ACTIVE org's projects through the tRPC server caller → protectedProcedure →
// withTenant → RLS, so only the active org's rows come back (a client orgId is never trusted).
// If the caller has no session / no active org, createCaller's protectedProcedure throws
// UNAUTHORIZED; we catch that and send the user to /login. The members/invite section mounts a
// "use client" island (owner-only invite) wrapped in the tRPC client provider. Minimal
// functional UI, es-AR voseo (D-13) — no design system this phase.
//
// This route lives in the (dashboard) route group, which does not affect the URL: it IS `/`.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { createCaller } from "@imbau/api";
import { TRPCReactProvider } from "../../lib/trpc-client";
import { InviteForm } from "./invite-form";

interface ProjectRow {
  id: string;
  nombre: string;
  slug: string;
  estado: string;
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const caller = await createCaller({ headers: await headers() });

  let projects: ProjectRow[];
  try {
    projects = await caller.projects.listForOrg();
  } catch (err) {
    // Narrow the catch (WR-03): only an auth failure means "you must log in" and warrants the
    // redirect. This is a server-side createCaller, so its rejections are TRPCError (from
    // @trpc/server) — UNAUTHORIZED = no session / no active org (a signed-up user lands here with
    // an active org; an invitee gets one on accept), FORBIDDEN = a role/tenant denial that also
    // routes to login. ANY other error (DB down, driver panic, etc.) MUST surface, not
    // masquerade as a logout — we re-throw so Next's error boundary (and Sentry in Phase 4)
    // records it. redirect() throws NEXT_REDIRECT, which is not a TRPCError, so it propagates.
    if (
      err instanceof TRPCError &&
      (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")
    ) {
      redirect("/login");
    }
    throw err;
  }

  return (
    <main>
      <h1>Panel · Proyectos</h1>
      {projects.length === 0 ? (
        <p>Todavía no hay proyectos en esta organización.</p>
      ) : (
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              {p.nombre} · {p.slug} · {p.estado}
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2>Miembros</h2>
        <p>Invitá a una persona a tu organización (solo el owner puede).</p>
        <TRPCReactProvider>
          <InviteForm />
        </TRPCReactProvider>
      </section>
    </main>
  );
}
