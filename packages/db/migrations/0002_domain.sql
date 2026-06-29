CREATE TYPE "public"."ajuste_tipo" AS ENUM('CAC', 'fijo');--> statement-breakpoint
CREATE TYPE "public"."galeria_seccion" AS ENUM('amenities', 'exteriores', 'interiores');--> statement-breakpoint
CREATE TYPE "public"."lead_estado" AS ENUM('nuevo', 'contactado', 'negociacion', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."moneda" AS ENUM('USD', 'ARS');--> statement-breakpoint
CREATE TYPE "public"."unidad_estado" AS ENUM('disponible', 'reservado', 'vendido');--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"nombre" text,
	"render_key" text,
	"poligono_svg" text,
	CONSTRAINT "floors_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "floors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"identificador" text NOT NULL,
	"tipologia" text,
	"m2" numeric,
	"orientacion" text,
	"ambientes" integer,
	"plano_key" text,
	"estado" "unidad_estado" DEFAULT 'disponible' NOT NULL,
	"poligono_svg" text,
	"orden" integer,
	CONSTRAINT "units_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"moneda" "moneda" NOT NULL,
	CONSTRAINT "price_lists_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unit_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"precio" integer NOT NULL,
	"vigencia" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"anticipo_pct" numeric NOT NULL,
	"cuotas" integer NOT NULL,
	"ajuste" "ajuste_tipo" NOT NULL,
	"refuerzos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notas_legales" text,
	CONSTRAINT "payment_plans_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "payment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cac_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"periodo" text NOT NULL,
	"valor" numeric(12, 4) NOT NULL,
	CONSTRAINT "cac_index_organization_id_periodo_unique" UNIQUE("organization_id","periodo")
);
--> statement-breakpoint
ALTER TABLE "cac_index" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payment_plan_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_key" text,
	"lead_id" uuid,
	CONSTRAINT "quotes_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brokers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"slug" text NOT NULL,
	"whatsapp" text,
	"email" text,
	CONSTRAINT "brokers_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "brokers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_id" uuid,
	"broker_id" uuid,
	"quote_id" uuid,
	"nombre" text NOT NULL,
	"contacto" text NOT NULL,
	"origen" text,
	"estado" "lead_estado" DEFAULT 'nuevo' NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "leads_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "progress_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"titulo" text NOT NULL,
	"media_id" uuid,
	"cuerpo" text
);
--> statement-breakpoint
ALTER TABLE "progress_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "galleries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"seccion" "galeria_seccion" NOT NULL,
	"imagenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pano360s" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "galleries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"original_key" text NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"width" integer,
	"height" integer,
	"blurhash" text,
	CONSTRAINT "media_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- ORDERING FIX (hand-reordered, like 0000_init.sql's hand-prepended role block): drizzle-kit emits
-- this parent UNIQUE on the pre-existing `projects` table AFTER the child composite FKs that depend
-- on it, so a fresh apply failed ("no unique constraint matching given keys for referenced table
-- projects"). Moved here, before the first composite FK. Editing the .sql does NOT change the
-- 0002 snapshot, so `db:generate` still reports no drift (verified).
ALTER TABLE "projects" ADD CONSTRAINT "projects_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_floor_id_organization_id_floors_id_organization_id_fk" FOREIGN KEY ("floor_id","organization_id") REFERENCES "public"."floors"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_unit_id_organization_id_units_id_organization_id_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."units"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_price_list_id_organization_id_price_lists_id_organization_id_fk" FOREIGN KEY ("price_list_id","organization_id") REFERENCES "public"."price_lists"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cac_index" ADD CONSTRAINT "cac_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_unit_id_organization_id_units_id_organization_id_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."units"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_payment_plan_id_organization_id_payment_plans_id_organization_id_fk" FOREIGN KEY ("payment_plan_id","organization_id") REFERENCES "public"."payment_plans"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_unit_id_organization_id_units_id_organization_id_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."units"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_broker_id_organization_id_brokers_id_organization_id_fk" FOREIGN KEY ("broker_id","organization_id") REFERENCES "public"."brokers"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_posts" ADD CONSTRAINT "progress_posts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_posts" ADD CONSTRAINT "progress_posts_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "floors_tenant" ON "floors" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("floors"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("floors"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "floors_anon_published" ON "floors" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "floors"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "units_tenant" ON "units" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("units"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("units"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "units_anon_published" ON "units" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "units"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "price_lists_tenant" ON "price_lists" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("price_lists"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("price_lists"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "price_lists_anon_published" ON "price_lists" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "price_lists"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "unit_prices_tenant" ON "unit_prices" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("unit_prices"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("unit_prices"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "unit_prices_anon_published" ON "unit_prices" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "unit_prices"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "payment_plans_tenant" ON "payment_plans" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("payment_plans"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("payment_plans"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "payment_plans_anon_published" ON "payment_plans" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "payment_plans"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "cac_index_tenant" ON "cac_index" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("cac_index"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("cac_index"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "quotes_tenant" ON "quotes" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("quotes"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("quotes"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "brokers_tenant" ON "brokers" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("brokers"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("brokers"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "brokers_anon_published" ON "brokers" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "brokers"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "leads_tenant" ON "leads" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("leads"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("leads"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "leads_anon_insert" ON "leads" AS PERMISSIVE FOR INSERT TO "anon" WITH CHECK (exists (select 1 from "projects" p where p.id = "leads"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "progress_posts_tenant" ON "progress_posts" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("progress_posts"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("progress_posts"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "progress_posts_anon_published" ON "progress_posts" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "progress_posts"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "galleries_tenant" ON "galleries" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("galleries"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("galleries"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "galleries_anon_published" ON "galleries" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "galleries"."project_id" and p.estado = 'publicado'));--> statement-breakpoint
CREATE POLICY "media_tenant" ON "media" AS PERMISSIVE FOR ALL TO "app_authenticated" USING ("media"."organization_id" = current_setting('app.current_organization_id', true)::text) WITH CHECK ("media"."organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "media_anon_published" ON "media" AS PERMISSIVE FOR SELECT TO "anon" USING (exists (select 1 from "projects" p where p.id = "media"."project_id" and p.estado = 'publicado'));