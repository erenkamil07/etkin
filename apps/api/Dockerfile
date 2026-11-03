# syntax=docker/dockerfile:1
# Build context is the repository root: docker build -f apps/api/Dockerfile .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer is cached until they change. Only the
# manifests are here yet, so lifecycle scripts are skipped: @etkin/shared's
# `prepare` (a build for the mobile app) would find no sources, and the build
# step below compiles it anyway.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@etkin/api..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# "@etkin/api..." builds the API and the workspace packages it depends on, in order.
# deploy copies only "files" (dist) plus production dependencies into /out.
RUN pnpm --filter "@etkin/api..." build \
 && pnpm --filter @etkin/api deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Migrations ship with the image so a deploy can apply them before the new
# version starts (`dbmate --wait up`; Railway runs it as the pre-deploy step).
# Same dbmate version as the repository's devDependency.
COPY --from=ghcr.io/amacneil/dbmate:2.37.0 /usr/local/bin/dbmate /usr/local/bin/dbmate
COPY --chown=node:node db/migrations ./db/migrations
ENV DBMATE_NO_DUMP_SCHEMA=true
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
