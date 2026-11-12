FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install from the lockfile first so the dependency layer is cached across
# source-only changes. `npm ci` is deterministic and fails on a stale lockfile.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DSH_SERVER_HOST=0.0.0.0 \
    DSH_SERVER_PORT=8080 \
    DSH_SERVER_DATA_FILE=/data/state.json
WORKDIR /app

# Runtime needs only the compiled output, the dependency tree and the manifest.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir /data && chown node:node /data
USER node
# Resolve the actual server import graph in the final image.
RUN node --input-type=module -e "await import('./dist/server.js')"
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.DSH_SERVER_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
