#!/usr/bin/env bash
# start.sh — Build and start all challenge services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

if [[ ! -f "$ROOT/.env" ]]; then
  echo "[start] .env not found. Run scripts/init-instance.sh first."
  exit 1
fi

cd "$ROOT"

echo "[start] Building images…"
docker compose build --parallel

echo "[start] Starting services…"
docker compose up -d

echo "[start] Waiting for web application to be ready…"
PORT=$(grep "^PUBLIC_PORT=" .env | cut -d= -f2 || echo "8080")
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/login" >/dev/null 2>&1; then
    echo "[start] Application is ready at http://localhost:$PORT"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "[start] Timed out waiting for application"
    docker compose logs web
    exit 1
  fi
done

echo "[start] Service status:"
docker compose ps
