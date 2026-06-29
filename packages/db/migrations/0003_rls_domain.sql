-- 0003_rls_domain.sql — hand-written RLS/partition/grant DDL that drizzle-kit CANNOT emit for the
-- full §3.3 domain schema (clone of the 0001_rls.sql idempotent style: DO / IF NOT EXISTS guards,
-- `--> statement-breakpoint` separators). It carries everything 0002_domain.sql (generated) leaves
-- out:
--   1. GRANT USAGE on the 5 new domain enums (so app/anon can use the enum types).
--   2. Scoped table GRANTs: app gets full DML on every new tenant table; anon gets SELECT-only on
--      the catalog/content tables (D-06/Pitfall 5), INSERT-only on leads (D-08, NO SELECT), and NO
--      grant at all on quotes / cac_index (tenant-private, A5).
--   3. FORCE ROW LEVEL SECURITY on EVERY new tenant table (Pitfall 1: the owner/migration role owns
--      the tables and would otherwise bypass RLS — including the generated policies in 0002).
--   4. ALL events DDL (FLAG-B): partitioned table by RANGE(ts), composite PK (id, ts), composite FK
--      → projects, monthly + DEFAULT partitions, GRANTs, ENABLE+FORCE RLS, and BOTH policies
--      (tenant clone + anon INSERT-only). Drizzle has no PARTITION BY support, so events is absent
--      from drizzle.config and created exclusively here.
--   5. The lead↔quote single-column FKs (cycle-break, D): leads.quote_id → quotes(id) and
--      quotes.lead_id → leads(id), both ON DELETE SET NULL. The TS modules deliberately omit these
--      `.references()` to keep the module graph acyclic; the real FKs land here, idempotently.

-- 1. GRANT USAGE on the 5 new domain enums (the `estado` enum was granted in 0001_rls).
GRANT USAGE ON TYPE "public"."unidad_estado" TO app_authenticated, anon;--> statement-breakpoint
GRANT USAGE ON TYPE "public"."lead_estado" TO app_authenticated, anon;--> statement-breakpoint
GRANT USAGE ON TYPE "public"."galeria_seccion" TO app_authenticated, anon;--> statement-breakpoint
GRANT USAGE ON TYPE "public"."ajuste_tipo" TO app_authenticated, anon;--> statement-breakpoint
GRANT USAGE ON TYPE "public"."moneda" TO app_authenticated, anon;--> statement-breakpoint

-- 2. Scoped table GRANTs (no ownership — D-04). RLS still scopes every app read/write to the active
-- org; anon SELECT is further gated to publicado projects by the anon_published policies in 0002.

-- 2a. Catalog/content tables — app full DML, anon SELECT-only (the public site reads these).
GRANT SELECT, INSERT, UPDATE, DELETE ON "floors" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "floors" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "units" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "units" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "price_lists" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "price_lists" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "unit_prices" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "unit_prices" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_plans" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "payment_plans" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "brokers" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "brokers" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "progress_posts" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "progress_posts" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "galleries" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "galleries" TO anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "media" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "media" TO anon;--> statement-breakpoint

-- 2b. Tenant-private tables — app full DML, NO anon grant (A5): an anon SELECT raises 42501.
GRANT SELECT, INSERT, UPDATE, DELETE ON "quotes" TO app_authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cac_index" TO app_authenticated;--> statement-breakpoint

-- 2c. leads — app full DML; anon INSERT-only (D-08). NO anon SELECT: the public site writes leads
-- but never reads them. The leads_anon_insert policy (0002) gates the write to publicado projects.
GRANT SELECT, INSERT, UPDATE, DELETE ON "leads" TO app_authenticated;--> statement-breakpoint
GRANT INSERT ON "leads" TO anon;--> statement-breakpoint

-- 3. FORCE ROW LEVEL SECURITY on EVERY new tenant table (Pitfall 1). The 12 non-events tables; the
-- events parent is FORCE'd in section 4. Without this the table owner (migration role) bypasses the
-- generated policies in 0002 and tenant isolation silently fails.
ALTER TABLE "floors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cac_index" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brokers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "progress_posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "galleries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 4. events — ALL DDL here (FLAG-B / SCHEMA-06). Partitioned BY RANGE(ts); the composite PK (id, ts)
-- includes the partition key (FLAG-A, a Postgres requirement). Column shape matches src/schema/
-- events.ts column-for-column; the composite FK pins every event to a same-tenant project. unit_id /
-- broker_id are plain nullable analytics pointers with NO FK (keeps the high-volume table write-light).
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid NOT NULL DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"unit_id" uuid,
	"broker_id" uuid,
	"session_id" text,
	"ts" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "events_id_ts_pk" PRIMARY KEY ("id", "ts"),
	CONSTRAINT "events_project_id_organization_id_projects_id_organization_id_fk"
		FOREIGN KEY ("project_id", "organization_id")
		REFERENCES "public"."projects"("id", "organization_id") ON DELETE cascade
) PARTITION BY RANGE ("ts");--> statement-breakpoint

-- Monthly partitions (current month + next 3) — idempotent so re-apply is a no-op. The worker
-- (01-05) pre-creates upcoming months; events_default (D-05) catches any out-of-range ts so an
-- INSERT never fails for an unprovisioned month.
CREATE TABLE IF NOT EXISTS "events_2026_06" PARTITION OF "events"
	FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_2026_07" PARTITION OF "events"
	FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_2026_08" PARTITION OF "events"
	FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_2026_09" PARTITION OF "events"
	FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_default" PARTITION OF "events" DEFAULT;--> statement-breakpoint

-- events GRANTs: app full DML; anon INSERT-only (D-08, NO SELECT). Grants on the parent cover all
-- partitions (the parent is the only access path).
GRANT SELECT, INSERT, UPDATE, DELETE ON "events" TO app_authenticated;--> statement-breakpoint
GRANT INSERT ON "events" TO anon;--> statement-breakpoint

-- events RLS: ENABLE + FORCE on the partitioned PARENT (D-07). Postgres propagates the parent's RLS
-- enablement + policies to every partition, so isolation holds for all months without per-partition
-- policy DDL. FORCE so the owner/migration role cannot bypass it (Pitfall 1).
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- events_tenant — flat clone of the tenant policy. `::text` cast (org id is TEXT); default-deny via
-- missing_ok `true`. The panel/API/worker read + write events tenant-scoped through this policy.
CREATE POLICY "events_tenant" ON "events" AS PERMISSIVE FOR ALL TO "app_authenticated"
	USING ("organization_id" = current_setting('app.current_organization_id', true)::text)
	WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint

-- events_anon_insert — the public site emits analytics events against a publicado project. INSERT →
-- `WITH CHECK` only (Postgres ignores USING for INSERT); the EXISTS rejects writes to borrador/
-- archivado projects (42501). NO anon SELECT policy: anon writes events but NEVER reads them (D-08).
CREATE POLICY "events_anon_insert" ON "events" AS PERMISSIVE FOR INSERT TO "anon"
	WITH CHECK (exists (select 1 from "projects" p where p.id = "events"."project_id" and p.estado = 'publicado'));--> statement-breakpoint

-- 5. lead↔quote single-column FKs (cycle-break, D). The TS modules omit these `.references()` so the
-- import graph stays acyclic; the real FKs are added here. Both ON DELETE SET NULL (a deleted lead/
-- quote nulls the back-pointer rather than cascading). Guarded by pg_constraint existence so a
-- re-apply (test harness / idempotent journal) is a no-op — Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS for foreign keys.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_quote_id_quotes_id_fk') THEN
		ALTER TABLE "leads" ADD CONSTRAINT "leads_quote_id_quotes_id_fk"
			FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_lead_id_leads_id_fk') THEN
		ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk"
			FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
	END IF;
END
$$;
