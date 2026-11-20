#!/usr/bin/env bash
# init-instance.sh — Generate a fresh .env file for a new challenge instance.
# Run this once before starting a new instance.  Never commit the generated .env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  echo "[init] .env already exists. Remove it first if you want to reinitialize."
  exit 1
fi

# Require openssl
command -v openssl >/dev/null 2>&1 || { echo "[init] openssl required"; exit 1; }

generate_hex() { openssl rand -hex "$1"; }
generate_b64() { openssl rand -base64 "$1" | tr -d '/+=' | head -c "$1"; }

MONGO_USER="geosupport"
MONGO_PASS="$(generate_hex 16)"
MONGO_DB="geosupport"

APP_SECRET="$(generate_hex 32)"
ADMIN_TOKEN="$(generate_hex 48)"

SEED_EMAIL="alice@geosupport.local"
SEED_PASS="$(generate_b64 20)"

INSTANCE_ID="$(generate_hex 4)"

# Use FLAG env var if set, otherwise use the challenge's default flag.
if [[ -n "${FLAG:-}" ]]; then
  FLAG="$FLAG"
else
  FLAG="IGT{n0sql_xss_ssrf_pwn3d}"
fi

PUBLIC_PORT="${PUBLIC_PORT:-8080}"

cat > "$ENV_FILE" <<EOF
# GeoSupport CTF instance — generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Instance ID: $INSTANCE_ID
# DO NOT COMMIT THIS FILE

MONGO_INITDB_ROOT_USERNAME=$MONGO_USER
MONGO_INITDB_ROOT_PASSWORD=$MONGO_PASS
MONGO_INITDB_DATABASE=$MONGO_DB

APP_SECRET=$APP_SECRET
ADMIN_SESSION_TOKEN=$ADMIN_TOKEN

SEED_USER_EMAIL=$SEED_EMAIL
SEED_USER_PASSWORD=$SEED_PASS

FLAG=$FLAG

QUEUE_PATH=/var/queue
PUBLIC_PORT=$PUBLIC_PORT
EOF

chmod 600 "$ENV_FILE"

echo "[init] Generated .env for instance $INSTANCE_ID"
echo "[init] Flag: $FLAG"
echo "[init] Public port: $PUBLIC_PORT"
echo ""
echo "[init] Run 'scripts/start.sh' to start the challenge."
