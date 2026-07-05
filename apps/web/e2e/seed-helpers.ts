// Shared seed resolver for the cotizador e2e specs (UI-01..06 / WA-01).
//
// The specs run against the SEEDED "Brigos Recoleta" project (slug `brigos-recoleta`), populated by
// `pnpm db:seed` into the Compose dev DB before the suite (RESEARCH Environment Availability). The
// seed is deterministic (uuidv5 ids, fixed jitter), so the ids/identificadores resolved here are
// stable across re-seeds — but we resolve them from Postgres at runtime rather than hardcoding, so a
// future seed tweak never silently rots the specs. If the project is missing we fail fast with the
// remediation command instead of surfacing an opaque "no floors" UI later.
//
// This is a READ-ONLY helper: it opens a short-lived `postgres` connection against the dev DB (the
// same driver + connection-string default the panel auth e2e uses), reads the project / floors /
// units / plans, closes the connection, and returns plain data. No RLS is exercised here — this is
// test scaffolding resolving fixtures, not the app's anon path (that path is what the UI drives).
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://imbau:dev@localhost:5432/imbau";

/** The seeded project slug (content.ts BUILDING.project.slug). */
export const SEED_SLUG = "brigos-recoleta";

export type SeedUnit = {
  id: string;
  identificador: string;
  estado: string;
  floorId: string;
  floorNumero: number;
  floorNombre: string;
};

export type SeedPlan = {
  id: string;
  anticipoPct: string;
  cuotas: number;
};

export type ResolvedSeed = {
  projectId: string;
  projectNombre: string;
  /** The raw whatsapp column value (e.g. "+5491155551234"). */
  whatsapp: string;
  /** Digits-only form the CTA uses in the wa.me host (matches buildWhatsappUrl). */
  whatsappDigits: string;
  slug: string;
  /** A floor carrying BOTH a `disponible` and a non-disponible unit (picker selectability check). */
  mixedFloor: { id: string; numero: number; nombre: string };
  /** A `disponible` unit ON `mixedFloor` — selectable in the picker. */
  disponibleUnit: SeedUnit;
  /** A `reservado`/`vendido` unit ON `mixedFloor` — NOT selectable in the picker. */
  nonDisponibleUnit: SeedUnit;
  /** Any `disponible` unit (used for the deep-link result specs). */
  anyDisponibleUnit: SeedUnit;
  /**
   * The most EXPENSIVE `disponible` unit (highest financiado list price). Cheap units + a
   * high-refuerzo plan legitimately yield a non-positive saldo (engine `SALDO_NO_POSITIVO`, the
   * documented soft-error path), so the RESULT specs must drive a unit whose financiado quote is
   * valid for BOTH plans — the priciest unit always is (largest saldo after refuerzos).
   */
  resultUnit: SeedUnit;
  /** Plans in the slider's deterministic order (anticipoPct asc, cuotas asc — mirrors sortPlans). */
  plans: SeedPlan[];
};

/** Mirror of lib/plan-snap.sortPlans: anticipoPct ascending, tie-broken by cuotas ascending. */
function sortPlans(plans: SeedPlan[]): SeedPlan[] {
  return [...plans].sort((a, b) => {
    const ap = Number(a.anticipoPct);
    const bp = Number(b.anticipoPct);
    if (ap !== bp) return ap - bp;
    return a.cuotas - b.cuotas;
  });
}

export async function resolveSeed(): Promise<ResolvedSeed> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const projectRows = await sql<
      { id: string; nombre: string; whatsapp: string | null; slug: string }[]
    >`
      select id, nombre, whatsapp, slug
      from projects
      where slug = ${SEED_SLUG} and estado = 'publicado'
      limit 1
    `;
    const project = projectRows[0];
    if (!project) {
      throw new Error(
        `Seed project '${SEED_SLUG}' not found in ${DATABASE_URL}. ` +
          "Run `pnpm db:seed` against the Compose dev DB before the apps/web e2e suite.",
      );
    }
    if (!project.whatsapp) {
      throw new Error(
        `Seed project '${SEED_SLUG}' has no whatsapp number — the CTA spec (WA-01) requires one.`,
      );
    }

    const unitRows = await sql<
      {
        id: string;
        identificador: string;
        estado: string;
        floorId: string;
        floorNumero: number;
        floorNombre: string | null;
      }[]
    >`
      select
        u.id,
        u.identificador,
        u.estado,
        u.floor_id      as "floorId",
        f.numero        as "floorNumero",
        f.nombre        as "floorNombre"
      from units u
      join floors f on f.id = u.floor_id
      where u.project_id = ${project.id}
      order by f.numero, u.identificador
    `;

    const planRows = await sql<
      { id: string; anticipoPct: string; cuotas: number }[]
    >`
      select id, anticipo_pct as "anticipoPct", cuotas
      from payment_plans
      where project_id = ${project.id}
    `;

    // The priciest disponible unit (max unit_price = the financiado list price; contado carries a
    // discount so it is always lower). Its financiado quote has the largest saldo, so it stays valid
    // for both seeded plans — the RESULT/CTA specs drive this unit.
    const resultRows = await sql<
      {
        id: string;
        identificador: string;
        estado: string;
        floorId: string;
        floorNumero: number;
        floorNombre: string | null;
      }[]
    >`
      select
        u.id,
        u.identificador,
        u.estado,
        u.floor_id as "floorId",
        f.numero   as "floorNumero",
        f.nombre   as "floorNombre",
        max(up.precio) as precio
      from units u
      join floors f on f.id = u.floor_id
      join unit_prices up on up.unit_id = u.id
      where u.project_id = ${project.id} and u.estado = 'disponible'
      group by u.id, u.identificador, u.estado, u.floor_id, f.numero, f.nombre
      order by precio desc
      limit 1
    `;
    const resultRow = resultRows[0];
    if (!resultRow) {
      throw new Error(
        "No priced disponible unit found — the result specs need one valid financiado quote.",
      );
    }
    const resultUnit: SeedUnit = {
      id: resultRow.id,
      identificador: resultRow.identificador,
      estado: resultRow.estado,
      floorId: resultRow.floorId,
      floorNumero: resultRow.floorNumero,
      floorNombre: resultRow.floorNombre ?? `Piso ${resultRow.floorNumero}`,
    };

    const units: SeedUnit[] = unitRows.map((u) => ({
      id: u.id,
      identificador: u.identificador,
      estado: u.estado,
      floorId: u.floorId,
      floorNumero: u.floorNumero,
      floorNombre: u.floorNombre ?? `Piso ${u.floorNumero}`,
    }));

    // Pick the lowest-numero floor that has BOTH a disponible and a non-disponible unit, so the
    // picker spec can assert selectable vs disabled side by side on the same floor.
    const byFloor = new Map<number, SeedUnit[]>();
    for (const u of units) {
      const list = byFloor.get(u.floorNumero) ?? [];
      list.push(u);
      byFloor.set(u.floorNumero, list);
    }
    let mixedUnits: SeedUnit[] | null = null;
    for (const numero of [...byFloor.keys()].sort((a, b) => a - b)) {
      const list = byFloor.get(numero)!;
      const hasDisp = list.some((u) => u.estado === "disponible");
      const hasNon = list.some((u) => u.estado !== "disponible");
      if (hasDisp && hasNon) {
        mixedUnits = list;
        break;
      }
    }
    if (!mixedUnits) {
      throw new Error(
        "No seeded floor carries both a disponible and a non-disponible unit — the picker " +
          "selectability spec cannot run. Re-seed the Brigos Recoleta building.",
      );
    }

    const disponibleUnit = mixedUnits.find((u) => u.estado === "disponible")!;
    const nonDisponibleUnit = mixedUnits.find((u) => u.estado !== "disponible")!;
    const anyDisponibleUnit =
      units.find((u) => u.estado === "disponible") ?? disponibleUnit;

    const plans = sortPlans(
      planRows.map((p) => ({
        id: p.id,
        anticipoPct: p.anticipoPct,
        cuotas: p.cuotas,
      })),
    );
    if (plans.length < 2) {
      throw new Error(
        "The seeded project has fewer than 2 payment plans — the slider spec (UI-04) needs at " +
          "least two preset stops.",
      );
    }

    return {
      projectId: project.id,
      projectNombre: project.nombre,
      whatsapp: project.whatsapp,
      whatsappDigits: project.whatsapp.replace(/\D/g, ""),
      slug: project.slug,
      mixedFloor: {
        id: disponibleUnit.floorId,
        numero: disponibleUnit.floorNumero,
        nombre: disponibleUnit.floorNombre,
      },
      disponibleUnit,
      nonDisponibleUnit,
      anyDisponibleUnit,
      resultUnit,
      plans,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
