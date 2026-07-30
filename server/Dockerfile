# Build context MUST be the repository root (`docker build -f server/Dockerfile .`)
# so npm workspaces can resolve the @crdt/shared package.
FROM node:20-alpine
WORKDIR /app

# Install deps first for layer caching. All workspace manifests must be present
# for `npm ci` to validate against the root package-lock.json.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY client/package.json client/package.json
COPY executor/package.json executor/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 3001

# @crdt/shared's package.json "exports" point at TypeScript sources, so a plain
# `tsc` build + `node dist/index.js` cannot resolve it at runtime. Run via tsx
# instead (already a devDependency, same as the `npm run dev` script uses).
CMD ["npx", "tsx", "src/index.ts"]
