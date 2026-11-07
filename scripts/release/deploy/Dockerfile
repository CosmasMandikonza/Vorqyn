# syntax=docker/dockerfile:1
FROM node:22.21.1-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Optional corporate/session CA stays out of image layers; ordinary hosts use
# the image's default trust store. TLS verification is never disabled.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@10.34.5 --ignore-scripts
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile && pnpm --filter @vorqyn/web build

FROM node:22.21.1-bookworm-slim AS runtime
WORKDIR /app
ARG VORQYN_BUILD_SHA
LABEL org.opencontainers.image.source="https://github.com/CosmasMandikonza/Vorqyn" \
      org.opencontainers.image.revision="${VORQYN_BUILD_SHA}"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Keep workspace symlinks and the actual external kernel/contract sources.
# This is a Node server image, not a static export or a Solana deployment.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]
