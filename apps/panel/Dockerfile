# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @imbau/panel (Next.js standalone) — APP-04 / D-16.
# Pattern: prune -> install/build -> slim Node 22 Alpine runner (CLAUDE.md
# "Architecture-adjacent configuration notes"). Authored only this phase; the
# image build is verified in CI (Phase 4) — there is no local Docker daemon.

# ---- prune: emit a sparse workspace for just @imbau/panel ----
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
# turbo prune --docker writes out/json (lockfile + manifests for caching the
# install layer) and out/full (the pruned source tree).
RUN pnpm dlx turbo prune @imbau/panel --docker

# ---- install + build ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
# Install deps against the pruned manifests first so this layer caches on
# lockfile changes only.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Bring in the pruned source and build the standalone output.
COPY --from=pruner /app/out/full/ .
# Env is validated at container boot, not at build (matches MONO-03/D-03).
ENV SKIP_ENV_VALIDATION=1
RUN pnpm turbo build --filter=@imbau/panel

# ---- runner: slim image with only the traced standalone output ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Trust the @vercel/nft standalone tracing — copy the traced tree as-is.
# NEVER re-run a production-only pnpm install here: it breaks the
# pnpm-symlinked traced node_modules (CLAUDE.md "What NOT to Use", Pitfall 5).
COPY --from=builder /app/apps/panel/.next/standalone ./
COPY --from=builder /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=builder /app/apps/panel/public ./apps/panel/public
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
