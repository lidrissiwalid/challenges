FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /build/dist ./dist
COPY public/ ./public/

RUN chown -R app:app /app

# Queue volume — must be writable by the app user
RUN mkdir -p /var/queue/jobs /var/queue/results && chown -R app:app /var/queue

USER app

EXPOSE 3000

CMD ["node", "dist/index.js"]
