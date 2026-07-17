---
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
plan: 02
subsystem: infra
tags: [staging, uat, rate-limit, nginx, pdf, worker, r2, loki, sentry, verification]

# Dependency graph
requires:
  - phase: 08-01
    provides: merge SHA 22d1e96 live on staging (web/panel/worker images), migrations 0000-0004, seed 'Brigos Recoleta' publicado
provides:
  - Live confirmation that v1.2 behaves on staging — DEBT-02 done
  - 08-UAT.md — reproducible command+output evidence (429 burst, PDF e2e, surface smoke)
  - Verified nginx box<->repo vhost parity (v1.2 D-12, no sync-back needed)
affects: [phase-09, panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reliable edge rate-limit UAT needs real concurrency + connection reuse (curl --parallel), not xargs -P with per-request TLS setup"
    - "tRPC on staging has NO transformer: batch POST body is {\"0\":{...}} directly (no .json wrapper)"
    - "Worker ships logs via the Loki log-driver (docker compose logs is empty; query Loki by service_name/quoteId instead)"

key-files:
  created:
    - .planning/phases/08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging/08-UAT.md
    - .planning/phases/08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging/08-02-SUMMARY.md
  modified: []

key-decisions:
  - "No nginx sync-back: box vhost is byte-identical (8581==8581) to the repo source of truth (v1.2 D-12)"
  - "Drove the CAC-adjusted financiado plan to exercise the richest PDF (CAC header + índice legend)"
  - "QR decode skipped (no local decoder); deep-link text assertion is the required check per D-11 and passed"

patterns-established:
  - "Edge rate-limit verification uses curl --parallel-max with a valid Content-Type to get real tRPC responses, not 415/404"

requirements-completed: [DEBT-02]

coverage:
  - id: D1
    description: "Burst to quotes.compute rejects excess with 429, zero 503, passing requests are real fase-5 tRPC (not 404)"
    requirement: "DEBT-02"
    verification:
      - kind: integration
        ref: "100 parallel POSTs (curl --parallel) -> 77x429 / 21x400 tRPC BAD_REQUEST / 0x503 / 0x404; error.log 'by zone \"quotes\"' 156 hits today"
        status: pass
    human_judgment: false
  - id: D2
    description: "Box nginx vhost equals the repo source of truth (v1.2 D-12)"
    requirement: "DEBT-02"
    verification:
      - kind: integration
        ref: "diff /etc/nginx/sites-available/staging.tours.andescode.com.ar vs deploy/nginx/...conf => identical (8581 bytes each), no sync-back"
        status: pass
    human_judgment: false
  - id: D3
    description: "End-to-end PDF: quote -> pdfStatus ready -> R2 download, Roboto embedded, es-AR accents, full header + 2 legends"
    requirement: "DEBT-02"
    verification:
      - kind: integration
        ref: "quoteId 5d67277a; pdffonts Roboto-Regular/Bold emb; pdftotext has Cotización/índice/m²/CAC 2026-06/Ref, 2 legends"
        status: pass
    human_judgment: false
  - id: D4
    description: "PDF deep-link targets the staging host (D-11)"
    requirement: "DEBT-02"
    verification:
      - kind: integration
        ref: "deep-link = https://staging.tours.andescode.com.ar/p/brigos-recoleta/cotizador?u=...&plan=... ; QR decode optional/skipped (no local decoder)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Surface smoke: web 200 / cotizador 200 / panel 307, worker alive, Loki+Sentry receiving (D-04)"
    requirement: "DEBT-02"
    verification:
      - kind: integration
        ref: "web 200, coti 200, panel 307; worker restarts=0 running; Loki has our quoteId 5d67277a line (service_name=worker); 0 Sentry init errors"
        status: pass
    human_judgment: false

# Metrics
duration: ~8min
completed: 2026-07-17
status: complete
---

# Phase 8 Plan 2: DEBT-02 live re-verification on staging Summary

**All three v1.2 live gaps confirmed on staging post-merge: the nginx edge rejects a quotes burst with 429 (77/100) and zero 503 while passing requests hit the real fase-5 app (400 tRPC, not the pre-merge 404), the end-to-end PDF pipeline renders a downloadable R2 PDF with embedded Roboto + correct es-AR accents whose deep-link targets the staging host, and the live surfaces smoke-pass (web 200 / cotizador 200 / panel 307, worker alive, Loki+Sentry receiving) — DEBT-02 done, all captured in 08-UAT.md.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-17T21:34Z
- **Completed:** 2026-07-17T21:42Z
- **Tasks:** 3
- **Files created:** 1 evidence doc (08-UAT.md); no source/repo config modified

## Accomplishments

- **Rate-limit contract (crit. 2):** A 100-request parallel burst (curl `--parallel`, connection reuse, valid Content-Type) to `quotes.compute` yielded **77×429 / 21×400 / 0×503 / 0×404**. The passing requests are real fase-5 tRPC `BAD_REQUEST` responses (not the 404 the pre-merge 05-UAT saw), proving the merged code is live. The `quotes` zone hit is logged in `/var/log/nginx/error.log` (`limiting requests ... by zone "quotes"`, 156 hits today from the UAT IP). The single in-budget request after cooldown passes (400) — one step either side of the threshold.
- **Nginx parity (v1.2 D-12):** `diff` of the box vhost (`/etc/nginx/sites-available/staging.tours.andescode.com.ar`, 8581 bytes) against the repo source of truth (`deploy/nginx/staging.tours.andescode.com.ar.conf`, 8581 bytes) is **byte-identical** — no in-place tuning happened, so no sync-back was needed.
- **PDF e2e (crit. 3):** Created a quote (financiado + CAC plan) for seeded unit 5B → quoteId `5d67277a` → `pdfStatus` ready on first poll → downloaded `cotizacion.pdf` from its presigned R2 URL. `pdffonts` shows `Roboto-Bold`/`Roboto-Regular` embedded (CID TrueType, subset, no tofu); `pdftotext` contains "Cotización"/"índice"/"m²", the full header (Brigos Recoleta / 5B · Piso 5 · 2 ambientes · 51.19 m² / Emitida · CAC 2026-06 · Ref 5D67277A), and both legal legends.
- **QR/deep-link (crit. 4):** The PDF deep-link is `https://staging.tours.andescode.com.ar/p/brigos-recoleta/cotizador?u=...&plan=...` — staging host, correct unit/plan IDs. QR decode was skipped (no local decoder installed); per D-11 the deep-link text check is the required assertion and it passed (the QR encodes the same link).
- **Surface smoke (D-04):** web `/` 200, cotizador 200, panel 307; worker `restarts=0`/running (it consumed our PDF job); Loki holds our exact quoteId `5d67277a` as a structured pino line (`service_name=worker`), confirming live ingest; zero Sentry init errors.

## Task Commits

1. **Task 1: Verify 429 burst + nginx parity** — verification-only, no repo file changed (box == repo, no sync-back). Evidence folded into 08-UAT.md.
2. **Task 2: PDF e2e + QR/deep-link + surface smoke** — verification-only, no repo file changed. Evidence folded into 08-UAT.md.
3. **Task 3: Author 08-UAT.md** — `test(08-02)` commit `e4c3f3e`.

## Files Created/Modified

- `.planning/phases/08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging/08-UAT.md` — the DEBT-02 evidence document (per-check `expected`/`result`/`evidence`, Summary 3/3 passed, Gaps).

## Decisions Made

- No nginx sync-back — the box vhost already matches the repo (v1.2 D-12 holds).
- Used the CAC financiado plan to drive the richest PDF (exercises the CAC header + "índice" legend glyphs).
- QR decode skipped (tooling absent) — deep-link text assertion satisfies D-11.

## Deviations from Plan

None affecting scope. One notable operational adaptation (not a spec deviation):

- **Burst method:** the plan's `xargs -P 20` recipe (from 05-UAT) produced 40×415 and zero 429 on the first attempt — per-request TLS setup spaced arrivals under the 10r/s refill. Switched to `curl --parallel-max 100` with connection reuse and a valid `Content-Type: application/json`, which deterministically exceeds rate+burst and elicits real tRPC responses. Same contract verified (429 not 503), stronger evidence.

## Issues Encountered

- `docker compose logs worker` returns empty on staging — the worker uses the Loki log-driver, so logs go straight to Loki rather than json-file. Confirmed worker liveness/activity by querying Loki (our quoteId present) + `docker inspect` (restarts=0). Not a fault — expected observability wiring.
- No local QR decoder (pyzbar/cv2/zbarimg) — QR decode skipped per D-11 (optional); deep-link text check covers it.
- VPS safety (D-08): all SSH work was read-only (log/DB/container inspection); no process killed, prod nginx/host untouched, no secret values echoed (T-08-04).

## User Setup Required

None. (The fase-6 human visual pass stays deferred to `/gsd-verify-work 6` per D-06 — out of scope.)

## Next Phase Readiness

- **Phase 9 unblocked:** v1.2 is now merged, deployed, seeded, AND live-verified on staging. The rate-limit contract, PDF pipeline, and staging-correct links are proven — the panel features (Phase 9+) build on a confirmed foundation.
- No blockers.

## Known Stubs

None — this is a verification plan; no code or stubs introduced.

## Self-Check: PASSED

- File present: `08-UAT.md` (frontmatter `status: complete`, 3/3 passed).
- Commit present: `e4c3f3e` (test(08-02): record DEBT-02 evidence) on `fase-0/foundation`.
- Live evidence captured: burst 77×429/0×503, box==repo vhost, PDF quoteId 5d67277a with embedded Roboto + staging deep-link, Loki holds our quoteId.

---
*Phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging*
*Completed: 2026-07-17*
