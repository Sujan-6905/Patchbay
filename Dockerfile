# syntax=docker/dockerfile:1

# ---- deps: install every workspace's dependencies once, cached by lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci

# ---- build: compile shared+server, build the client bundle ----
FROM deps AS build
COPY . .
RUN npm run build -w shared && npm run build -w server && npm run build -w client

# ---- prod-deps: a second, production-only install (skips client/e2e's dev-only
# tooling (Vite, Playwright) so the runtime image doesn't carry a browser download ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --omit=dev --workspace=server --workspace=shared

# ---- runtime: slim image, compiled output + only the deps it needs to run ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/dist ./client/dist

EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
