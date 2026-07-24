FROM node:20-alpine

# Install Docker CLI so the executor can spawn sibling containers
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package.json ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

EXPOSE 3002

CMD ["node", "dist/index.js"]
