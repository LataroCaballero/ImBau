# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @imbau/worker (tsup dist) — APP-04 / D-16.
# Pattern: prune -> install/build -> slim Node 22 Alpine runner (CLAUDE.md
# "Architecture-adjacent configuration notes", worker variant). Authored only
# this phase; the image build is verified in CI (Phase 4) — no local Docker daemon.

# ---- prune: emit a sparse workspace for just @imbau/worker ----
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
# turbo prune --docker writes out/json (lockfile + manifests for caching the
# install layer) and out/full (the pruned source tree).
RUN pnpm dlx turbo prune @imbau/worker --docker

# ---- install + build (tsup -> dist/) ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
# Install deps against the pruned manifests first so this layer caches on
# lockfile changes only.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Bring in the pruned source and build the bundle.
COPY --from=pruner /app/out/full/ .
# Env is validated at container boot, not at build (matches MONO-03/D-03).
ENV SKIP_ENV_VALIDATION=1
# tsup bundles @imbau/* (noExternal) into apps/worker/dist; external runtime
# deps (bullmq, ioredis) stay in node_modules.
RUN pnpm turbo build --filter=@imbau/worker

# ---- runner: slim image with the tsup dist + external runtime deps ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Drop root (WR-04): run the worker as the non-root `node` user that already
# exists in node:22-alpine (uid 1000). --chown on each COPY makes that user own
# the bundle + node_modules so it can read them; USER node switches before CMD.
# Copy the bundled output. tsup inlines internal @imbau/* packages, so only the
# external deps (bullmq/ioredis) need to come along — copy the worker's traced
# node_modules as built. Do NOT re-run a production-only pnpm install here:
# keep the same no-prod-install discipline used for the Next standalone runners.
COPY --from=builder --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
USER node
CMD ["node", "apps/worker/dist/index.js"]
