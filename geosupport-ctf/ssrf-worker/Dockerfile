FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json worker.ts ./
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN addgroup -S worker && adduser -S worker -G worker

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /build/dist ./dist

RUN mkdir -p /var/queue/jobs /var/queue/results && chown -R worker:worker /app /var/queue

USER worker

CMD ["node", "dist/worker.js"]
