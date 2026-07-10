# ---- Build stage: compile the dashboard and the server ----------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install the whole workspace (shared + server + web) with dev deps for tsc/vite. Copy every
# workspace manifest before the sources so `npm ci` layer-caches on dependency changes alone.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN npm ci

# Build shared, then web (vite) and server (tsc) against it.
COPY . .
RUN npm run build:all

# ---- Runtime stage: production deps + compiled output -----------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prod-only install. Workspaces wire @app/shared into node_modules as a symlink, so the server
# resolves it from packages/shared/dist (copied below).
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN npm ci --omit=dev

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/public ./packages/server/public
# Bundled Arabic font for button-text PNGs (packages/server/src/core/titleImage.ts -> ../../assets).
COPY --from=build /app/packages/server/assets ./packages/server/assets
COPY --from=build /app/packages/web/dist ./packages/web/dist

EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "packages/server/dist/server.js"]
