FROM node:22-bookworm-slim AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json bot.ts ./
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Install Playwright system dependencies for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
    libcairo2 libxshmfence1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system bot && adduser --system --ingroup bot bot

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Install Chromium as root so it's accessible to any user
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/ms-playwright
RUN npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

RUN chown -R bot:bot /app && chmod -R 755 /usr/local/ms-playwright 2>/dev/null || true

COPY --from=builder /build/dist ./dist

USER bot

CMD ["node", "dist/bot.js"]
