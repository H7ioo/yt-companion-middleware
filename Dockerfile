# ---- Build stage: compile the dashboard and the server ----------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install server deps (with dev deps for tsc).
COPY package.json package-lock.json* ./
RUN npm install

# Install web deps.
COPY web/package.json web/package-lock.json* ./web/
RUN npm install --prefix web

# Build web then server.
COPY . .
RUN npm run build:web && npm run build

# ---- Runtime stage: production deps + compiled output -----------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/public ./public
# Bundled Arabic font for button-text PNG rendering (src/core/titleImage.ts resolves ../../assets).
COPY --from=build /app/assets ./assets

EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "dist/server.js"]
