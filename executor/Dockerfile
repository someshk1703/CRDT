FROM node:20-alpine
WORKDIR /app

# docker CLI only — talks to the host daemon via the socket mounted in
# docker-compose.yml (local dev). Harmless no-op on Railway, which has no
# socket to mount, so isDockerAvailable() there just falls back to Judge0.
RUN apk add --no-cache docker-cli

COPY package.json ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

EXPOSE 3002

CMD ["node", "dist/index.js"]
