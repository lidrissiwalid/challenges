#!/usr/bin/env bash
# cleanup.sh — Stop and remove all challenge containers, volumes, and networks.
# WARNING: This destroys all instance data including the database.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

cd "$ROOT"

echo "[cleanup] Stopping and removing containers, networks, and volumes…"
docker compose down -v --remove-orphans

echo "[cleanup] Done."
