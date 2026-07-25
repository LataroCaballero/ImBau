// seedContentRows — brokers, leads (+timeline), galleries, progress_posts, events (SEED-03, D-07,
// RESEARCH Pattern 4, PATTERNS §110-124). Every row gets a deterministic id (seedId) and ends
// `.onConflictDoNothing()`; every write goes through withTenant (the production RLS path). All copy
// is authored es-AR in content.ts — this module only shapes rows + resolves deterministic ids.
//
// Media coupling: galleries.imagenes[] and progress_posts.mediaId reference the SAME deterministic
// mediaIds seedMedia produces (via mediaSeedId), computed here from the catalog — so content is
// coherent whether or not media was actually seeded this run (skipMedia). These are plain uuid refs
// (no FK), so referencing a media id whose row is not yet present is valid.
//
// Timeline + event timestamps derive from SEED_REFERENCE_DATE minus a fixed dayOffset — never a
// wall-clock read (determinism). LeadNote[] is validated with leadNoteSchema before insert (T-03-04
// / ASVS V5: even seed data passes the boundary validator). Events use fixed ts across ≥2 months so
// they route to the pre-created events_YYYY_MM partitions (D-07, Pitfall 5).
import { withTenant } from "../with-tenant";
import * as schema from "../schema";
import { seedId, SEED_REFERENCE_DATE } from "./ids";
import { mediaSeedId } from "./media";
import { leadNoteSchema, type LeadNote } from "../schema/json-schemas";
import type { SeededUnit } from "./building";
import {
  BROKERS,
  LEADS,
  PROGRESS_POSTS,
  MEDIA_ASSETS,
  GALLERY_SECCIONES,
  EVENT_TIPOS,
  EVENT_DAY_OFFSETS,
} from "./content";

export interface ContentRefs {
  /** Seeded units (from seedBuilding) — leads/events pin a deterministic one. */
  readonly units: readonly SeededUnit[];
}

const MS_PER_DAY = 86_400_000;

// A fixed instant `dayOffset` days before SEED_REFERENCE_DATE (deterministic, never now()).
function tsFromOffset(dayOffset: number): Date {
  return new Date(SEED_REFERENCE_DATE.getTime() - dayOffset * MS_PER_DAY);
}

// Stable non-negative hash of a key → deterministic index into a list (unit pinning).
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickUnit(key: string, units: readonly SeededUnit[]): SeededUnit | undefined {
  if (units.length === 0) return undefined;
  return units[hashKey(key) % units.length];
}

const brokerId = (key: string): string => seedId(`brigos:broker:${key}`);

export async function seedContentRows(
  orgId: string,
  projectId: string,
  refs: ContentRefs,
): Promise<void> {
  // ── brokers ──────────────────────────────────────────────────────────────────────────────
  const brokerRows = BROKERS.map((b) => ({
    id: brokerId(b.key),
    organizationId: orgId,
    projectId,
    nombre: b.nombre,
    slug: b.slug,
    whatsapp: b.whatsapp,
    email: b.email,
  }));
  await withTenant(orgId, (tx) =>
    tx.insert(schema.brokers).values(brokerRows).onConflictDoNothing(),
  );

  // ── leads (+ validated LeadNote[] timeline) ────────────────────────────────────────────────
  const leadRows: (typeof schema.leads.$inferInsert)[] = LEADS.map((l) => {
    const timeline: LeadNote[] = l.timeline.map((n) =>
      leadNoteSchema.parse({
        ts: tsFromOffset(n.dayOffset).toISOString(),
        ...(n.autor ? { autor: n.autor } : {}),
        nota: n.nota,
        ...(n.estadoPrev ? { estadoPrev: n.estadoPrev } : {}),
        ...(n.estadoNuevo ? { estadoNuevo: n.estadoNuevo } : {}),
      }),
    );
    const unit = l.attachUnit ? pickUnit(l.key, refs.units) : undefined;
    return {
      id: seedId(`brigos:lead:${l.key}`),
      organizationId: orgId,
      projectId,
      ...(unit ? { unitId: unit.id } : {}),
      ...(l.brokerKey ? { brokerId: brokerId(l.brokerKey) } : {}),
      nombre: l.nombre,
      contacto: l.contacto,
      origen: l.origen,
      estado: l.estado,
      // desenlace only on cerrado leads (D-03); undefined → column stays null. This is a
      // DIRECT tx.insert (below), NOT the leads.create seam — a re-seed enqueues zero emails.
      ...(l.desenlace ? { desenlace: l.desenlace } : {}),
      timeline,
    };
  });
  await withTenant(orgId, (tx) =>
    tx.insert(schema.leads).values(leadRows).onConflictDoNothing(),
  );

  // ── galleries (one per seccion; imagenes[] = deterministic mediaIds of that seccion's assets) ─
  const galleryRows = GALLERY_SECCIONES.map((seccion) => ({
    id: seedId(`brigos:gallery:${seccion}`),
    organizationId: orgId,
    projectId,
    seccion,
    imagenes: MEDIA_ASSETS.filter(
      (a) => a.usage === "gallery" && a.seccion === seccion,
    ).map((a) => mediaSeedId(a.key)),
  }));
  await withTenant(orgId, (tx) =>
    tx.insert(schema.galleries).values(galleryRows).onConflictDoNothing(),
  );

  // ── progress_posts (fecha from SEED_REFERENCE_DATE; mediaId = plain uuid ref, no FK) ─────────
  const progressRows = PROGRESS_POSTS.map((p) => ({
    id: seedId(`brigos:progress:${p.key}`),
    organizationId: orgId,
    projectId,
    fecha: tsFromOffset(p.dayOffset),
    titulo: p.titulo,
    mediaId: mediaSeedId(p.mediaKey),
    cuerpo: p.cuerpo,
  }));
  await withTenant(orgId, (tx) =>
    tx.insert(schema.progressPosts).values(progressRows).onConflictDoNothing(),
  );

  // ── events (fixed ts across ≥2 monthly partitions; unitId is a plain analytics pointer) ──────
  const eventRows: (typeof schema.events.$inferInsert)[] = EVENT_DAY_OFFSETS.map(
    (offset, i) => {
      const tipo = EVENT_TIPOS[i % EVENT_TIPOS.length]!;
      const unit = refs.units.length > 0 ? refs.units[i % refs.units.length] : undefined;
      return {
        id: seedId(`brigos:event:${i}`),
        organizationId: orgId,
        projectId,
        tipo,
        ...(unit ? { unitId: unit.id } : {}),
        sessionId: seedId(`brigos:session:${i}`),
        ts: tsFromOffset(offset),
      };
    },
  );
  await withTenant(orgId, (tx) =>
    tx.insert(schema.events).values(eventRows).onConflictDoNothing(),
  );
}
