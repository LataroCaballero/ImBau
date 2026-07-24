import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Job } from "bullmq";
import { LEAD_EMAIL_QUEUE, type LeadEmailJobData } from "@imbau/storage";

// Orchestration tests for the lead-email processor (LEADS-04). Mirrors quote-pdf.test.ts: every
// I/O seam is vi.mocked so this proves recipient resolution (D-05 fallback), origen resolution
// (LEADS-01), single-send, and observable failure (D-06) WITHOUT touching Postgres, Redis, or
// Resend.
//
// Mocked seams:
//   - @imbau/db: withTenant is replaced so readLeadForEmail returns a CONTROLLED composite row
//     (its query-builder callback never runs) — the DB query itself is left to integration, and
//     org_owner_emails was already runtime-verified in Plan 11-04a. `schema` is a stub (the
//     callback that references it is bypassed).
//   - @imbau/api/email: sendLeadNotification → a spy (no Resend, no network).
//   - ./env: a fixed BETTER_AUTH_URL so the deep-link is deterministic (no env load).
//   - @imbau/observability + @sentry/node: spies so the failure-report path asserts structured
//     ids only (no raw payload / PII).
vi.mock("@imbau/db", () => ({
  withTenant: vi.fn(),
  schema: {},
}));
vi.mock("@imbau/api/email", () => ({
  sendLeadNotification: vi.fn(),
}));
vi.mock("./env", () => ({
  env: { BETTER_AUTH_URL: "https://panel.test" },
}));
vi.mock("@imbau/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import {
  processLeadEmail,
  reportLeadEmailFailure,
  readLeadForEmail,
} from "./lead-email";
import { withTenant } from "@imbau/db";
import { sendLeadNotification } from "@imbau/api/email";
import { logger } from "@imbau/observability";
import * as Sentry from "@sentry/node";

// The composite row readLeadForEmail resolves to. Defaults model a "Directo" lead with a
// configured project email; each test overrides the fields it exercises.
type LeadRow = Awaited<ReturnType<typeof readLeadForEmail>>;

function makeRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    nombre: "Ana Gómez",
    contacto: "+54 11 5555-5555",
    brokerId: null,
    brokerNombre: null,
    unitId: null,
    unitIdentificador: null,
    quoteId: null,
    quoteRefId: null,
    projectNombre: "Brigos Recoleta",
    leadsNotifyEmail: "ventas@brigos.test",
    ownerEmails: [],
    ...overrides,
  };
}

function makeJob(data: LeadEmailJobData): Job<LeadEmailJobData> {
  // Only `data` is read by processLeadEmail; cast the minimal shape to the BullMQ Job type.
  return { data } as Job<LeadEmailJobData>;
}

const JOB: LeadEmailJobData = {
  leadId: "lead-1",
  organizationId: "org-1",
  projectId: "proj-1",
};

describe("processLeadEmail (orchestration, db/email/env mocked)", () => {
  beforeEach(() => {
    vi.mocked(withTenant).mockReset();
    vi.mocked(sendLeadNotification).mockReset();
    vi.mocked(logger.info).mockClear();
  });

  it("configured email: sends once to project.leadsNotifyEmail under the payload tenant", async () => {
    vi.mocked(withTenant).mockResolvedValue(
      makeRow({ leadsNotifyEmail: "ventas@brigos.test" }),
    );

    await processLeadEmail(makeJob(JOB));

    // read runs under withTenant(job.data.organizationId).
    expect(withTenant).toHaveBeenCalledWith("org-1", expect.any(Function));
    expect(sendLeadNotification).toHaveBeenCalledTimes(1);
    expect(sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ventas@brigos.test",
        nombre: "Ana Gómez",
        contacto: "+54 11 5555-5555",
        projectNombre: "Brigos Recoleta",
        deepLink: "https://panel.test/proyectos/proj-1/leads",
      }),
    );
  });

  it("owner fallback: leadsNotifyEmail null → sends to the org owners (lead never lost)", async () => {
    vi.mocked(withTenant).mockResolvedValue(
      makeRow({ leadsNotifyEmail: null, ownerEmails: ["owner@org.test"] }),
    );

    await processLeadEmail(makeJob(JOB));

    expect(sendLeadNotification).toHaveBeenCalledTimes(1);
    expect(sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@org.test" }),
    );
  });

  it("owner fallback with multiple owners → comma list of every owner", async () => {
    vi.mocked(withTenant).mockResolvedValue(
      makeRow({
        leadsNotifyEmail: null,
        ownerEmails: ["a@org.test", "b@org.test"],
      }),
    );

    await processLeadEmail(makeJob(JOB));

    expect(sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@org.test, b@org.test" }),
    );
  });

  it("no recipient (null email + no owner) → throws so the job fails, never a silent drop", async () => {
    vi.mocked(withTenant).mockResolvedValue(
      makeRow({ leadsNotifyEmail: null, ownerEmails: [] }),
    );

    await expect(processLeadEmail(makeJob(JOB))).rejects.toThrow(
      /no recipient/i,
    );
    expect(sendLeadNotification).not.toHaveBeenCalled();
  });

  describe("origen resolution (mirrors leads.listForProject)", () => {
    it("broker pointer → origen = broker nombre", async () => {
      vi.mocked(withTenant).mockResolvedValue(
        makeRow({ brokerId: "b-1", brokerNombre: "Inmobiliaria Sur" }),
      );
      await processLeadEmail(makeJob(JOB));
      expect(sendLeadNotification).toHaveBeenCalledWith(
        expect.objectContaining({ origen: "Inmobiliaria Sur" }),
      );
    });

    it("unit pointer → origen = unidad identificador", async () => {
      vi.mocked(withTenant).mockResolvedValue(
        makeRow({ unitId: "u-1", unitIdentificador: "4B" }),
      );
      await processLeadEmail(makeJob(JOB));
      expect(sendLeadNotification).toHaveBeenCalledWith(
        expect.objectContaining({ origen: "4B" }),
      );
    });

    it("quote pointer → origen = cotización id", async () => {
      vi.mocked(withTenant).mockResolvedValue(
        makeRow({ quoteId: "q-1", quoteRefId: "q-1" }),
      );
      await processLeadEmail(makeJob(JOB));
      expect(sendLeadNotification).toHaveBeenCalledWith(
        expect.objectContaining({ origen: "q-1" }),
      );
    });

    it("all pointers null → origen = Directo", async () => {
      vi.mocked(withTenant).mockResolvedValue(makeRow());
      await processLeadEmail(makeJob(JOB));
      expect(sendLeadNotification).toHaveBeenCalledWith(
        expect.objectContaining({ origen: "Directo" }),
      );
    });
  });

  it("a read/send error propagates (BullMQ marks the job failed)", async () => {
    vi.mocked(withTenant).mockRejectedValue(new Error("db down"));

    await expect(processLeadEmail(makeJob(JOB))).rejects.toThrow("db down");
    expect(sendLeadNotification).not.toHaveBeenCalled();
  });
});

describe("reportLeadEmailFailure (observable, ids only)", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("routes to Sentry + pino with structured ids and NEVER the raw payload/PII", () => {
    const err = new Error("resend 500");

    reportLeadEmailFailure(err, { leadId: "lead-9", attempts: 3 });

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { leadId: "lead-9", attempts: 3 },
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logObj] = vi.mocked(logger.error).mock.calls[0] ?? [];
    // Structured ids only: leadId + queue present…
    expect(logObj).toMatchObject({ leadId: "lead-9", queue: LEAD_EMAIL_QUEUE });
    // …and NO lead PII / raw payload fields ever logged (T-11-10 / privacy).
    expect(logObj).not.toHaveProperty("nombre");
    expect(logObj).not.toHaveProperty("contacto");
    expect(logObj).not.toHaveProperty("data");
  });
});
