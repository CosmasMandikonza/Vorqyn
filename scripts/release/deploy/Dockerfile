# syntax=docker/dockerfile:1
FROM node:22.21.1-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Optional corporate/session CA stays out of image layers; ordinary hosts use
# the image's default trust store. TLS verification is never disabled.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@10.34.5 --ignore-scripts
COPY --chown=node:node . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store && \
    rm -rf /tmp/pnpm-store && \
    pnpm --filter @vorqyn/web build && \
    chown -R node:node apps/web/.next
ARG VORQYN_BUILD_SHA
LABEL org.opencontainers.image.source="https://github.com/CosmasMandikonza/Vorqyn" \
      org.opencontainers.image.revision="${VORQYN_BUILD_SHA}"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Preserve workspace symlinks and actual external kernel/contract sources.
# A single stage avoids duplicating this workspace on VFS Docker daemons.
# This is a Node server image, not a static export or a Solana deployment.
USER node
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]
