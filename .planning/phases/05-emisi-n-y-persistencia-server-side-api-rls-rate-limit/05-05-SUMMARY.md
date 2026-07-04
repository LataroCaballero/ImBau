---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
plan: 05
subsystem: infra
tags: [nginx, rate-limit, limit_req, staging, edge, ddos, quotes]

# Dependency graph
requires:
  - phase: 04-staging-ci-cd
    provides: "host-nginx staging vhost (deploy/nginx/) with pre-documented limit_req skeleton, applied by hand on the VPS (04-07)"
  - phase: 05-04
    provides: "quotes tRPC router mounted on apps/web at /api/trpc/quotes (the path being throttled)"
provides:
  - "Edge rate-limit (nginx limit_req, per-IP) for the anonymous quotes tRPC path, returning 429 on burst"
  - "Versioned, apply-ready staging vhost as the source of truth for the QUOTE-03 edge throttle"
  - "In-file manual apply + 429 curl-burst UAT procedure for the operator"
affects: [fase-6-metricas-alertas-qa, fase-6-client-wiring, staging-ops]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "nginx limit_req_zone at http-level + dedicated location ^~ for the throttled path (web-only)"
    - "explicit limit_req_status 429 to override nginx's 503 default for API contracts"
    - "config versioned in deploy/nginx/ = source of truth; manual apply + human UAT on the VPS (D-12)"

key-files:
  created: []
  modified:
    - deploy/nginx/staging.tours.andescode.com.ar.conf

key-decisions:
  - "Kept the throttle web-only (D-10) — panel and prod vhosts untouched, grep-gated"
  - "limit_req_status 429 is mandatory: nginx default reject is 503, which would break the fase-6 retry contract (CITED)"
  - "rate=10r/s burst=20 are D-11 starting points, tunable by hand during UAT; tuned values must sync back to the repo file"

patterns-established:
  - "Anonymous-write edge throttle: per-IP limit_req zone + ^~ prefix location on the web vhost, 429 reject"

requirements-completed: [QUOTE-03]

coverage:
  - id: D1
    description: "nginx limit_req_zone (quotes:10m rate=10r/s) declared at http level + location ^~ /api/trpc/quotes on the web :443 block with burst=20 nodelay and limit_req_status 429; panel/prod untouched"
    requirement: "QUOTE-03"
    verification:
      - kind: other
        ref: "grep gates (zone/429/location present, panel clean) + docker nginx:alpine parse (directive grammar valid; only expected cert-not-found emerg + pre-existing http2 warnings)"
        status: pass
      - kind: manual_procedural
        ref: "VPS apply (nginx -t + systemctl reload) + curl-burst of 40 POSTs to https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1 → first ~20 pass, excess returns 429"
        status: unknown
    human_judgment: true
    rationale: "The authoritative nginx -t and the 429 burst demonstration run on the VPS with real certs; this is the phase's end-of-phase human UAT (D-12), not runnable in CI."
  - id: D2
    description: "In-file 'Phase 5 rate-limit apply' operator procedure: sites-available update, config-test + reload (never certbot --nginx), curl-burst 429 UAT, and the sync-back-to-repo rule"
    requirement: "QUOTE-03"
    verification:
      - kind: other
        ref: "grep gates: 'Phase 5 rate-limit apply' header, exact staging UAT URL, and 'source of truth, D-12' note all present"
        status: pass
    human_judgment: false

# Metrics
duration: ~10min
completed: 2026-07-04
status: complete
---

# Phase 05 Plan 05: nginx edge rate-limit for the anonymous quotes path Summary

**Per-IP nginx `limit_req` (rate=10r/s burst=20 nodelay) on `location ^~ /api/trpc/quotes` of the staging web vhost, returning 429 (not the 503 default) — versioned as the source of truth, applied by hand on the VPS.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-04T21:45:00Z (approx)
- **Completed:** 2026-07-04T21:48:15Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Declared a per-IP `limit_req_zone $binary_remote_addr zone=quotes:10m rate=10r/s` at the top of the vhost (valid at http level because sites-enabled files are included inside the host nginx's `http{}` context).
- Added a dedicated `location ^~ /api/trpc/quotes` on the web `:443` block with `limit_req zone=quotes burst=20 nodelay;`, `limit_req_status 429;`, and the same loopback backend (`127.0.0.1:8092`) as `location /` — throttle is web-only; panel and prod vhosts untouched.
- Set the reject status explicitly to 429 (nginx defaults to 503, which would break the fase-6 retry contract and the QUOTE-03 UAT) [CITED].
- Documented, in the conf header, the full manual apply + 429 curl-burst UAT procedure so an operator can apply and verify end-to-end from the file alone.
- Best-effort validated the directive grammar with `docker run nginx:alpine nginx -t`: all `limit_req*` directives parse cleanly (the only failures are the expected local cert-not-found `[emerg]` and pre-existing `http2` deprecation warnings, both unrelated to this change).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the quotes limit_req zone + location to the web vhost** - `b5cf0df` (feat)
2. **Task 2: Document the manual apply + 429 UAT procedure in the conf header** - `8232002` (docs)

## Files Created/Modified
- `deploy/nginx/staging.tours.andescode.com.ar.conf` - Added the http-level `quotes` limit_req zone, the `location ^~ /api/trpc/quotes` throttle block (429 reject), the "Phase 5 rate-limit apply" operator note in the header, and updated the web block's stale "DEFERRED" comment to point at the now-active quotes block (events/leads remain deferred).

## Decisions Made
- **Throttle scope is web-only (D-10):** the panel `:443` block and all prod vhosts were left byte-for-byte untouched; the anonymous funnel is the only surface that needs the edge limit.
- **Explicit `limit_req_status 429`:** overriding nginx's 503 default is a correctness requirement, not a preference — the fase-6 client and QUOTE-03 UAT key off 429 (CITED, RESEARCH Pitfall 2).
- **`^~` prefix on `/api/trpc/quotes`:** matches the tRPC quotes-only batched POST path (`/api/trpc/quotes.compute,quotes.create?batch=1`). Documented in-file as RESEARCH Assumption A1: fase 6 must keep quotes calls on a quotes-only client link, or the limit must widen to `/api/trpc/`.
- **rate/burst are D-11 starting points:** tunable by hand during UAT; any tuned value must be synced back to the repo file (source of truth, D-12).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Plan's automated panel-untouched gate has a false positive.** The gate `awk '/panel.staging.tours.andescode.com.ar;$/,0' | grep -c "limit_req zone=quotes" | grep -qx 0` starts the awk range at the FIRST line ending in `panel.staging.tours.andescode.com.ar;` — which is the HTTP `:80` block's combined `server_name` line, ABOVE the web block — so it captures the web quotes location and reports `PANEL_CONTAMINATED` even for a correct config. Re-checking with a precise anchor (`awk '/server_name panel/,0'`) confirms the panel `:443` block contains only a **commented** deferred `limit_req` line and no active `limit_req zone=quotes` — the panel block is genuinely untouched. This is a bug in the verification gate's regex, not in the config; the config satisfies the acceptance criterion.

## User Setup Required
None automated here, but the QUOTE-03 edge limit requires a **manual VPS apply + human UAT** (documented in the conf header, D-12):
1. On the VPS (`root@andescode.com.ar`): copy this file into `/etc/nginx/sites-available/…`, keep the existing symlink.
2. `nginx -t && systemctl reload nginx` (never `certbot --nginx`; prod vhosts untouched).
3. Curl-burst UAT: fire ~40 rapid POSTs at `https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1`; confirm the first ~20 pass and the excess returns **429** (not 503). Record statuses in the phase UAT.

## Next Phase Readiness
- The QUOTE-03 edge throttle is versioned and apply-ready; the 429 burst is queued as the phase's end-of-phase human UAT (D-12).
- **Fase-6 flag (RESEARCH Assumption A1):** the quotes client must post quotes-only batches (so the POST path stays under `/api/trpc/quotes`), or the `^~` prefix won't throttle co-batched calls — revisit at fase-6 client wiring, or widen the limit to `/api/trpc/` on the web vhost.

---
*Phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit*
*Completed: 2026-07-04*
