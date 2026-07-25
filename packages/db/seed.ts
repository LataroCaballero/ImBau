// packages/db/seed.ts — the `pnpm db:seed` entry (SEED-01..04). Mirrors migrate.ts's standalone
// shape, but because it imports the (extensionless) @imbau/db src graph it runs via `tsx`, not
// `node --experimental-strip-types` (which cannot resolve extensionless relative imports).
//
// Orchestration (RESEARCH Pattern 3/4):
//   0. assertSeedPrerequisites(opts) — fail-fast BEFORE any write (D-05).
//   1. OWNER pool (createOwnerDb) — insert the `organization` tenant ROOT (not parent-scoped, so
//      it uses the superuser owner exactly like makeOrg) + pre-create events monthly partitions
//      (DDL only the owner may run). The owner is used for NOTHING else.
//   2. withTenant(orgId, …) — every tenant-scoped domain row, exercising the production RLS write
//      path (app_authenticated + the `app.current_organization_id` GUC + `*_tenant` withCheck).
//   Every insert derives its id from seedId(name) and ends `.onConflictDoNothing()` → re-runnable.
//
// The owner client is always closed in `finally`. A thrown error propagates (non-zero exit) —
// errors are never swallowed (CLAUDE.md).
import { fileURLToPath } from "node:url";
import { createOwnerDb } from "./src/client";
import { withTenant } from "./src/with-tenant";
import * as schema from "./src/schema";
import { seedId, SEED_REFERENCE_DATE } from "./src/seed/ids";
import { BUILDING } from "./src/seed/content";
import { assertSeedPrerequisites } from "./src/seed/prerequisites";
import { seedBuilding } from "./src/seed/building";
import { seedPricing } from "./src/seed/pricing";
import { seedMedia } from "./src/seed/media";
import { seedRenders } from "./src/seed/renders";
import { seedContentRows } from "./src/seed/content-rows";

// ── Events partition pre-create (idempotent owner DDL) ──────────────────────────────────────
// Mirrors apps/worker/src/partitions.ts renderCreatePartitionSql — replicated (not imported)
// because a package must NOT depend on an app. IF NOT EXISTS keeps re-runs a no-op. We pre-create
// the reference month + the prior `monthsBack` months so D-07 cross-month events (plan 02/03)
// route to ≥2 real monthly partitions instead of the DEFAULT catch-all.
interface PartitionSpec {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

function firstOfMonth(year: number, month1: number): string {
  return `${year.toString().padStart(4, "0")}-${month1.toString().padStart(2, "0")}-01`;
}

function monthSpec(year: number, month1: number): PartitionSpec {
  const nextMonth1 = month1 === 12 ? 1 : month1 + 1;
  const nextYear = month1 === 12 ? year + 1 : year;
  return {
    name: `events_${year.toString().padStart(4, "0")}_${month1.toString().padStart(2, "0")}`,
    from: firstOfMonth(year, month1),
    to: firstOfMonth(nextYear, nextMonth1),
  };
}

export function eventPartitionSpecs(reference: Date, monthsBack: number): PartitionSpec[] {
  const specs: PartitionSpec[] = [];
  const refYear = reference.getUTCFullYear();
  const refMonth1 = reference.getUTCMonth() + 1; // 1..12
  for (let back = monthsBack; back >= 0; back -= 1) {
    const total = refYear * 12 + (refMonth1 - 1) - back;
    const year = Math.floor(total / 12);
    const month1 = (total % 12) + 1;
    specs.push(monthSpec(year, month1));
  }
  return specs;
}

function renderCreatePartitionSql(spec: PartitionSpec): string {
  return (
    `CREATE TABLE IF NOT EXISTS "${spec.name}" PARTITION OF "events" ` +
    `FOR VALUES FROM ('${spec.from}') TO ('${spec.to}')`
  );
}

export interface RunSeedOptions {
  readonly skipMedia?: boolean;
}

export async function runSeed(opts?: RunSeedOptions): Promise<void> {
  // 0. Fail-fast prerequisite guard — aborts before any write if infra/env is missing (D-05).
  await assertSeedPrerequisites(opts);

  // 1. OWNER pool — org root + partition DDL ONLY.
  const { db: owner, client } = createOwnerDb(process.env.DATABASE_URL!);
  try {
    const orgId = seedId("brigos:org");
    await owner
      .insert(schema.organization)
      .values({
        id: orgId,
        name: BUILDING.org.name,
        slug: BUILDING.org.slug,
        createdAt: SEED_REFERENCE_DATE,
      })
      .onConflictDoNothing();

    // Pre-create the reference month + prior 2 months of events partitions (idempotent).
    for (const spec of eventPartitionSpecs(SEED_REFERENCE_DATE, 2)) {
      await client.unsafe(renderCreatePartitionSql(spec));
    }

    // 2. withTenant — the publicado project (tenant-scoped, RLS write path).
    const projectId = seedId("brigos:project");
    await withTenant(orgId, (tx) =>
      tx
        .insert(schema.projects)
        .values({
          id: projectId,
          organizationId: orgId,
          nombre: BUILDING.project.nombre,
          slug: BUILDING.project.slug,
          estado: "publicado",
          // Default WhatsApp CTA number (D-01/D-02): demo/staging always render the CTA,
          // never a dead button. Broker routing (maestro phase 5) overrides this per-lead later.
          whatsapp: "+5491155551234",
        })
        .onConflictDoNothing(),
    );

    // ── Domain row generators (invoked in composite-FK order after the project) ───────────────
    // Building catalog (floors + units) then pricing (price_lists + payment_plans + unit_prices +
    // cac_index). The seeded units flow into pricing so unit_prices attach to them.
    const units = await seedBuilding(orgId, projectId);
    await seedPricing(orgId, projectId, units);

    // Media through the REAL R2 + worker pipeline (D-04). Skipped for DB-only runs (skipMedia:
    // tests + CI without R2/worker); the `db:seed` CLI always runs it with the D-05 guard active.
    // galleries/progress_posts reference the SAME deterministic mediaIds (mediaSeedId) whether or
    // not this runs, so content stays coherent even when media rows/variants are not produced.
    if (!opts?.skipMedia) {
      await seedMedia(orgId, projectId);
    }

    // Render fixture (phase 12): idempotently point projects.renderExteriorKey + a few
    // floors.renderKey at the already-seeded gallery assets' originalKeys so the hotspot editor's
    // draw-over-render happy path has a resolvable background at UAT (RESEARCH §7). Runs AFTER
    // seedMedia so the referenced media originalKeys exist in R2; guarded by isNull → safe re-run.
    await seedRenders(orgId, projectId);

    // Content rows: brokers → leads (+timeline) → galleries → progress_posts → events (across ≥2
    // monthly partitions). galleries/progress reference the deterministic mediaIds seedMedia
    // produced (or would produce), so this is correct with media either on or skipped.
    await seedContentRows(orgId, projectId, { units });
  } finally {
    await client.end({ timeout: 5 });
  }
}

// Direct-invocation entry (tsx seed.ts). When imported by a test, this guard is false so runSeed
// is only called explicitly by the test. Compares the entry script to this module's path (robust
// across Node versions — avoids relying on the newer import.meta.main).
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await runSeed();
  // Force a clean exit: client.ts opens the process-global app/anon pools at import; they have no
  // exported close, so without this the one-shot CLI would hang on the open connections after the
  // seed logically completes. runSeed already closed its owner client. Tests import runSeed and
  // never hit this branch, so their own teardown is unaffected.
  process.exit(0);
}
