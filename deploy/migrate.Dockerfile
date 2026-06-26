# syntax=docker/dockerfile:1
# Minimal owner-role migration runner for @imbau/db (INFRA-02 / D-07).
#
# Mirrors apps/worker/Dockerfile's prune -> install multi-stage, but targets @imbau/db and runs
# the migrator FROM SOURCE via Node's type-stripping (`node --experimental-strip-types`) — there
# is no tsup bundle and, crucially, no drizzle-kit (a devDependency that the pruned runtime tree
# does not carry). All the migrator needs is drizzle-orm + the packages/db/migrations journal,
# both present after the frozen install.
#
# Built + run only in the deploy pipeline (plan 04-06 / 04-07): `docker compose run --rm migrate`
# applies the journal as the OWNER role, gating the app swap on its exit code. No local Docker
# daemon here — the image build is exercised on the VPS.

# ---- prune: emit a sparse workspace for just @imbau/db (source + migrations) ----
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
# turbo prune --docker writes out/json (lockfile + manifests, for a cacheable install layer)
# and out/full (the pruned @imbau/db source tree, including packages/db/migrations).
RUN pnpm dlx turbo prune @imbau/db --docker

# ---- install: frozen install against the pruned manifests, then bring in the source ----
# The migrator runs directly from this stage: pnpm's symlinked node_modules stays intact here,
# so there is no separate slim runner (copying pnpm symlinks would break the linked tree —
# the same footgun the Next standalone / worker images avoid). The migrate container is one-off
# and internal-only.
FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
# Install first so this layer caches on lockfile changes only.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Bring in the pruned source (packages/db/migrate.ts + packages/db/migrations).
COPY --from=pruner /app/out/full/ .
ENV NODE_ENV=production
# Run the journal as the OWNER role from raw DATABASE_URL (drizzle-orm migrator, type-stripped
# source). A non-zero exit ABORTS the deploy gate before the app swap (deploy.sh, plan 04-06).
CMD ["node", "--experimental-strip-types", "packages/db/migrate.ts"]
