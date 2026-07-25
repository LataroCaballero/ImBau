# Phase 8: Deuda v1.2 — merge a main + re-verificación en staging - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 2 artifacts + 1 chore commit (ops phase — no product code)
**Analogs found:** 2 / 2

## Scope note

This is a **mechanical ops/verification phase**, not a feature phase. It writes almost no code. The only file-system artifact is a UAT evidence document; the rest is git/`gh`/SSH/curl operations against the live VPS. The nginx config, deploy workflow, and deploy script listed below are **read-only sources of truth** the executor re-runs and inspects — they are NOT modified in this phase (rate-limit is applied by hand on the box and already synced; migrate-before-swap runs itself on merge).

## File Classification

| New/Modified Artifact | Role | Data Flow | Closest Analog | Match Quality |
|-----------------------|------|-----------|----------------|---------------|
| `08-UAT.md` (evidence doc) | test/verification | request-response (curl + SSH capture) | `05-UAT.md` + `07-UAT.md` | exact |
| Optional `smoke.sh` (429 burst + pdfStatus poll) | utility/script | batch (curl loop) | inline recipe in `05-UAT.md` line 24-32 nginx conf comment lines 29-34 | exact (inline, not a repo file) |
| `chore:` commit of GSD tooling changes | git op | n/a — no code | Conventional Commits (CLAUDE.md) | n/a |

**No new source code, no new repo scripts required.** There is no `scripts/` convention in the repo (only `.claude/scripts` for GSD tooling). The burst/poll checks are trivial inline `for`/`curl` loops run ad-hoc and captured into `08-UAT.md`; do NOT create a permanent repo script unless the executor finds reuse value.

## Pattern Assignments

### `08-UAT.md` (verification evidence document)

**Analog:** `.planning/milestones/v1.2-phases/05-UAT.md` and `.planning/milestones/v1.2-phases/07-UAT.md`

**Frontmatter + structure pattern** (05-UAT.md lines 1-13):
```markdown
---
status: complete
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
source: [08-VERIFICATION.md]
started: <ISO8601>
updated: <ISO8601>
---

## Current Test
[testing complete]

## Tests
```

**Per-test evidence block pattern** (05-UAT.md lines 15-36) — each test has `expected:`, `result: pass|fail`, and a multiline `evidence: |` capturing the exact commands run + real output. Note the disciplined style: names the SSH host/key, the exact URL hit, the observed status distribution, and cross-references why a non-obvious result is still a pass.

**Summary + Gaps tail** (05-UAT.md lines 38-49):
```markdown
## Summary
total: N
passed: N
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
[none]
```

---

### Check 1 — 429 rate-limit burst (DEBT re-verification, QUOTE-03)

**Source recipe:** `05-UAT.md` lines 24-32 (already run once against staging) and the canonical recipe embedded in `deploy/nginx/staging.tours.andescode.com.ar.conf` lines 29-34.

**Burst command** (from the nginx conf comment — the source of truth):
```bash
for i in $(seq 1 40); do \
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1"; \
done
```
The prior run used parallelism (`xargs -P 20`) to guarantee excess over `burst=20 nodelay`. **Expected:** first ~20 pass through to the app (200/4xx of tRPC — now that fase-5 code is deployed, expect real tRPC responses, NOT the 404 the 05-UAT saw pre-merge), excess returns **429 — never 503**. Confirm zone hit via `/var/log/nginx/error.log` (`limiting requests ... by zone "quotes"`) over SSH (`root@31.97.175.128`, key `id_vps_andescode`). Confirm vhost intact post-burst (web 200, panel 307).

**Config invariant to assert (read-only):** `deploy/nginx/...conf` line 44 `limit_req_zone ... zone=quotes:10m rate=10r/s;`, lines 83-85 `location ^~ /api/trpc/quotes { limit_req zone=quotes burst=20 nodelay; limit_req_status 429; }`. The box copy MUST equal the repo file (D-12). If tuned on the box, sync back to the repo file.

---

### Check 2 — PDF e2e with es-AR accents + QR/deep-link (DEBT, PDF-07)

**Source recipe:** `07-UAT.md` lines 15-49 (verified in LOCAL; staging pending post-merge — this phase closes that gap).

**Verification method pattern** (07-UAT.md): trigger via UI/Playwright → poll `quotes.pdfStatus` until ready (D-10) → download `cotizacion.pdf` → inspect with:
- `pdffonts cotizacion.pdf` → assert `Roboto-Regular`/`Roboto-Bold` embedded (CID TrueType, no tofu)
- `pdftotext cotizacion.pdf -` → assert accents ("Cotización", "índice"), two legal legends, full header (proyecto/unidad/piso/tipología/m²/fecha/CAC/ref)
- QR/deep-link (D-11): extract `?u=&plan=` deep-link from PDF text and assert it points to `https://staging.tours.andescode.com.ar/...`; decode the embedded QR with local tooling if available (e.g. `zbarimg` on a rasterized page) — executor picks tooling.

**Soft-fail path** (07-UAT.md lines 28-36): worker unreachable → "No pudimos generar el PDF, probá de nuevo en un rato." at ~40s, button resets, WhatsApp CTA stays enabled.

## Shared Patterns

### Merge + deploy trigger
**Source:** `.github/workflows/deploy-staging.yml` lines 24-27, 97-107
**Apply to:** the merge step. `push` to `main` (or manual `workflow_dispatch`) triggers build of 4 images → GHCR → SSH to VPS → `IMAGE_TAG=${{ github.sha }} bash deploy/deploy.sh`. Merge PR #5 with `gh pr merge 5 --merge` (D-01, merge commit — NOT squash). Branch protection requires the `quality` check green before merge.

### Migrate-before-swap gate (verify, don't touch)
**Source:** `deploy/deploy.sh` lines 81-101
**Apply to:** Check that migrations 0004+ applied (D-05). The `migrate` container runs under `set -e` BEFORE the app swap; a non-zero exit leaves the old images running (safe state, D-07). Verify over SSH: inspect migrate container logs and query `drizzle` migration table. If seed "Brigos Recoleta" missing, run seed against staging (D-05).

### SSH inspection convention
**Source:** established in `05-UAT.md` line 19, MEMORY (staging-vps-topology)
**Apply to:** all live checks. `root@31.97.175.128` / `root@andescode.com.ar`, key `id_vps_andescode`. VPS is SHARED with prod — never touch prod nginx/host, inspect process identity before any kill (D-08, MEMORY never-kill-unverified-pid).

### Commit conventions
**Source:** CLAUDE.md
**Apply to:** the `chore:` commit (D-02) and phase docs. Conventional Commits, English. Co-author trailer required. Work lands on the active branch per D-03 (`main` post-merge, or `fase-4/panel` once v1.3 starts).

## No Analog Found

None. Both verification checks have exact prior-run recipes in the v1.2 UAT archive; the deploy/nginx/git operations all have established sources of truth in the repo.

## Metadata

**Analog search scope:** `.planning/milestones/v1.2-phases/`, `deploy/`, `.github/workflows/`, repo root scripts dirs
**Files scanned:** 5 (2 UAT docs, deploy.sh, nginx conf, deploy-staging.yml)
**Pattern extraction date:** 2026-07-17
