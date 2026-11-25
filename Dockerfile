# SunTech POS — NestJS 11 / Prisma 6 / PostgreSQL
# Requires prisma CLI and @prisma/client in production dependencies.
# Keep their versions aligned (e.g., both 6.19.3).

FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p assets \
    && ./node_modules/.bin/prisma generate --schema prisma/schema \
    && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma

# Install only production dependencies. Prisma CLI is required at startup.
USER node
RUN npm ci --omit=dev \
    && ./node_modules/.bin/prisma generate --schema prisma/schema

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/assets ./assets

EXPOSE 10000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema && exec node dist/main.js"]
