// The lead-email pipeline (LEADS-04) — the worker CONSUMER that turns a queued lead-created event
// into a single notification email. Mirrors quote-pdf.ts: a thin impure processor that reads the
// lead + project under withTenant(payload.orgId) (the worker has no session, so the tenant comes
// from the payload — the same rationale as processQuotePdf), resolves the recipient
// (project.leadsNotifyEmail ?? the org owners), builds the bandeja deep-link, and dispatches via
// @imbau/api/email. Idempotency is the producer's jobId=`lead:{id}:created` dedup (Plan 03); here
// the processor is a pure single-send per invocation — a retried/duplicate created-event drains to
// exactly one send.
//
// SECURITY (T-11-09 / T-11-11): every read runs as `app_authenticated` through withTenant — NEVER
// the owner/BYPASSRLS pool. The owner-email fallback does NOT read the intentionally un-RLS'd
// Better Auth `user` table directly (app_authenticated has NO grant on it); it goes through the
// hardened `public.org_owner_emails(orgId)` SECURITY DEFINER function (migration 0007) — the single
// org-scoped door, EXECUTE-granted to app_authenticated only (revoked from PUBLIC/anon). So a lead
// can only ever be sent to the tenant's configured email or its own owners — never an address
// outside the tenant.
//
// OBSERVABILITY (CLAUDE.md): any error propagates so BullMQ marks the job failed; the failed
// handler (index.ts boot) delegates to reportLeadEmailFailure → Sentry + pino, carrying structured
// ids ONLY (leadId/attempts/queue) — never the raw payload, never PII, never swallowed.
import type { Job } from "bullmq";
import * as Sentry from "@sentry/node";
import { and, eq, sql } from "drizzle-orm";
import { withTenant, schema } from "@imbau/db";
import { logger } from "@imbau/observability";
import { LEAD_EMAIL_QUEUE, type LeadEmailJobData } from "@imbau/storage";
import { sendLeadNotification } from "@imbau/api/email";
import { env } from "./env";

// Everything the processor needs to render one lead notification, read under RLS in a SINGLE
// withTenant tx. The `broker*`/`unit*`/`quote*` fields are the raw pointers + their tenant-scoped
// join labels; the processor resolves them to the es-AR chip string (mirrors leads.listForProject).
// `ownerEmails` is the D-05 fallback recipient set, resolved via public.org_owner_emails ONLY when
// leadsNotifyEmail is null (so a lead with a configured email costs no extra owner lookup).
interface LeadForEmail {
  readonly nombre: string;
  readonly contacto: string;
  readonly brokerId: string | null;
  readonly brokerNombre: string | null;
  readonly unitId: string | null;
  readonly unitIdentificador: string | null;
  readonly quoteId: string | null;
  readonly quoteRefId: string | null;
  readonly projectNombre: string;
  readonly leadsNotifyEmail: string | null;
  readonly ownerEmails: readonly string[];
}

// Resolve the origen chip label exactly like leads.listForProject (LEADS-01): broker nombre >
// unidad identificador > cotización id > "Directo" (every pointer null). Kept in the processor
// (not inside the read tx) so the unit test exercises it directly against a controlled row.
function resolveOrigen(lead: LeadForEmail): string {
  if (lead.brokerId && lead.brokerNombre !== null) return lead.brokerNombre;
  if (lead.unitId && lead.unitIdentificador !== null) return lead.unitIdentificador;
  if (lead.quoteId && lead.quoteRefId !== null) return lead.quoteRefId;
  return "Directo";
}

/**
 * Read the lead (nombre/contacto + origen join labels) + project (nombre, leadsNotifyEmail) and,
 * ONLY when there is no configured recipient, the org owners' emails — all in a SINGLE
 * withTenant(orgId) transaction (app_authenticated + the tenant GUC). RLS scopes every read to the
 * org. The owner-email lookup goes through the org_owner_emails SECURITY DEFINER door (migration
 * 0007) because app_authenticated has NO direct grant on the un-RLS'd `user` table (T-11-11).
 *
 * A missing lead/project row throws so BullMQ marks the job failed — never a silently dropped
 * notification (CLAUDE.md: errors observable, never swallowed).
 */
export async function readLeadForEmail(
  orgId: string,
  leadId: string,
  projectId: string,
): Promise<LeadForEmail> {
  return withTenant(orgId, async (tx) => {
    // origen resolution mirrors leads.listForProject: leftJoin brokers/units/quotes on the
    // composite (id, organizationId) so a pointer resolves to its label within THIS tenant only.
    const [lead] = await tx
      .select({
        nombre: schema.leads.nombre,
        contacto: schema.leads.contacto,
        brokerId: schema.leads.brokerId,
        unitId: schema.leads.unitId,
        quoteId: schema.leads.quoteId,
        brokerNombre: schema.brokers.nombre,
        unitIdentificador: schema.units.identificador,
        quoteRefId: schema.quotes.id,
      })
      .from(schema.leads)
      .leftJoin(
        schema.brokers,
        and(
          eq(schema.leads.brokerId, schema.brokers.id),
          eq(schema.leads.organizationId, schema.brokers.organizationId),
        ),
      )
      .leftJoin(
        schema.units,
        and(
          eq(schema.leads.unitId, schema.units.id),
          eq(schema.leads.organizationId, schema.units.organizationId),
        ),
      )
      .leftJoin(
        schema.quotes,
        and(
          eq(schema.leads.quoteId, schema.quotes.id),
          eq(schema.leads.organizationId, schema.quotes.organizationId),
        ),
      )
      .where(eq(schema.leads.id, leadId));
    if (!lead) {
      throw new Error(
        `lead not found for notification (id ${leadId}) — wrong tenant or deleted`,
      );
    }

    const [project] = await tx
      .select({
        nombre: schema.projects.nombre,
        leadsNotifyEmail: schema.projects.leadsNotifyEmail,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!project) {
      throw new Error(
        `project not found for lead notification (id ${projectId})`,
      );
    }

    // D-05 fallback: resolve org owners ONLY when there is no configured recipient. The call goes
    // through the org_owner_emails SECURITY DEFINER function (migration 0007) — the sole door
    // app_authenticated has to owner emails; the org id is passed as an explicit argument so the
    // scope is caller-explicit and auditable. tx.execute returns the driver RowList; narrow it to
    // the aliased `email` column (justified cast — drizzle types execute as a generic row bag).
    let ownerEmails: string[] = [];
    if (project.leadsNotifyEmail === null) {
      const rows = (await tx.execute(
        sql`select o as email from public.org_owner_emails(${orgId}) as o`,
      )) as unknown as Array<{ email: string }>;
      ownerEmails = rows.map((r) => r.email);
    }

    return {
      nombre: lead.nombre,
      contacto: lead.contacto,
      brokerId: lead.brokerId,
      brokerNombre: lead.brokerNombre,
      unitId: lead.unitId,
      unitIdentificador: lead.unitIdentificador,
      quoteId: lead.quoteId,
      quoteRefId: lead.quoteRefId,
      projectNombre: project.nombre,
      leadsNotifyEmail: project.leadsNotifyEmail,
      ownerEmails,
    };
  });
}

/**
 * The ONLY side effect of the lead-email pipeline (LEADS-04). Reads the lead + project under the
 * payload tenant, resolves the recipient (configured email ?? org owners — D-05), builds the
 * bandeja deep-link, and dispatches exactly one notification via @imbau/api/email. On success a
 * single structured pino line logs (ids only). Any error propagates so BullMQ marks the job failed;
 * the failed handler (reportLeadEmailFailure, wired in index.ts boot) reports it observably.
 *
 * organizationId comes from the job payload — the worker has no session (same rationale as
 * processQuotePdf). The recipient is NEVER a client-supplied address: both branches derive from
 * tenant-scoped reads, so a lead cannot be sent outside the tenant (T-11-09).
 */
export async function processLeadEmail(
  job: Job<LeadEmailJobData>,
): Promise<void> {
  const { leadId, organizationId, projectId } = job.data;

  const lead = await readLeadForEmail(organizationId, leadId, projectId);

  // Recipient resolution (D-05 / T-11-09): the configured per-project email, else the org owners.
  const recipients = lead.leadsNotifyEmail
    ? [lead.leadsNotifyEmail]
    : [...lead.ownerEmails];
  if (recipients.length === 0) {
    // A lead is NEVER lost silently (D-05): with no configured email AND no org owner resolvable,
    // fail the job so BullMQ retries + the failure becomes observable — never a dropped notice.
    throw new Error(
      `no recipient for lead notification (lead ${leadId}) — project has no leadsNotifyEmail and the org resolved no owner`,
    );
  }

  // Bandeja deep-link (D-07): the apps/panel base origin + the project's leads board. Multiple
  // owners → a comma list (Resend accepts a multi-recipient `to`); the configured-email path is a
  // single address.
  const deepLink = `${env.BETTER_AUTH_URL}/proyectos/${projectId}/leads`;

  await sendLeadNotification({
    to: recipients.join(", "),
    nombre: lead.nombre,
    contacto: lead.contacto,
    origen: resolveOrigen(lead),
    projectNombre: lead.projectNombre,
    deepLink,
  });

  logger.info({ leadId, organizationId }, "lead notification sent");
}

/**
 * Observable failure reporting for the lead-email pipeline (D-06 / T-11-10) — a verbatim clone of
 * reportQuotePdfFailure. A job that throws (the withTenant read or the Resend dispatch) is marked
 * failed by BullMQ; index.ts wires `leadEmailWorker.on("failed", …)` to delegate here. This routes
 * the error to BOTH Sentry (captureException with leadId/attempts as searchable context) AND the
 * structured pino logger — the error is NEVER swallowed (CLAUDE.md).
 *
 * It does NOT re-throw or swallow: it only reports. BullMQ owns the retry policy (jobId dedup +
 * attempts/backoff, set by the producer's leadEmailJobOptions in Plan 03). Only structured ids
 * (leadId, attempts, queue) are emitted — NEVER the raw payload or lead PII (T-11-10 / privacy).
 */
export function reportLeadEmailFailure(
  err: unknown,
  ctx: { leadId?: string; attempts?: number },
): void {
  Sentry.captureException(err, {
    extra: { leadId: ctx.leadId, attempts: ctx.attempts },
  });
  logger.error(
    { err, leadId: ctx.leadId, queue: LEAD_EMAIL_QUEUE },
    "lead email job failed",
  );
}
