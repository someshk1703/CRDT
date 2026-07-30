# Build context MUST be the repository root (`docker build -f client/Dockerfile .`)
# so Vite's `@crdt/shared` alias (../shared/src) resolves correctly.

# ── Stage 1: Build static assets ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY executor/package.json executor/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/

WORKDIR /app/client

# Vite inlines VITE_* vars at build time — declare as ARGs so Railway's service
# variables of the same name are passed through automatically.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WS_URL
ARG VITE_API_URL
# Standalone deploy (Railway) serves from the domain root; default to '/'.
ARG VITE_BASE_PATH=/
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_API_URL=$VITE_API_URL \
    VITE_BASE_PATH=$VITE_BASE_PATH \
    NODE_ENV=production

RUN npm run build

# ── Stage 2: Serve static files ───────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY --from=builder /app/client/dist ./dist

EXPOSE 4173
# Railway assigns $PORT dynamically — bind to it, falling back for local runs.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-4173}"]
