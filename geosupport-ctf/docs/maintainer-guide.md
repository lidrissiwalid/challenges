# Maintainer Guide

## Daily operations

### Check all services are healthy

```bash
cd geosupport-ctf
docker compose ps
```

Expected output — all five services `Up`:
```
nginx        Up   0.0.0.0:8080->8080/tcp
web          Up   3000/tcp
mongo        Up (healthy)   27017/tcp
admin-bot    Up
ssrf-worker  Up
```

### Watch admin bot activity

```bash
docker compose logs -f admin-bot
```

Normal output every 8 seconds:
```
[bot] Visiting http://web:3000/admin/chat
[bot] Visit complete (marked 0 message(s) visited)
```

### Watch the SSRF worker

```bash
docker compose logs -f ssrf-worker
```

Normal startup:
```
[worker] SSRF worker started
[worker] Queue path: /var/queue
[worker] Flag server listening on 127.0.0.1:80
```

Each SSRF job:
```
[worker] Processing job <uuid> → http://127.0.0.1/flag.txt
[worker] Job <uuid> done — HTTP 200
```

---

## Resetting between teams

If the same instance is reused for different teams, reset the database and restart the web container to clear in-memory sessions:

```bash
# Clear messages and captures
docker compose exec mongo mongosh \
  --username "$(grep MONGO_INITDB_ROOT_USERNAME .env | cut -d= -f2)" \
  --password "$(grep MONGO_INITDB_ROOT_PASSWORD .env | cut -d= -f2)" \
  --authenticationDatabase admin \
  "$(grep MONGO_INITDB_DATABASE .env | cut -d= -f2)" \
  --quiet --eval "db.messages.deleteMany({}); db.captures.deleteMany({}); print('done')"

# Clear customer sessions (in-memory — restart web)
docker compose restart web
```

---

## Changing the flag mid-event

```bash
# Edit .env
sed -i 's/^FLAG=.*/FLAG=IGT{new_flag_here}/' .env

# Restart only the SSRF worker
docker compose up -d ssrf-worker

# Verify
ADMIN_TOKEN=$(grep ADMIN_SESSION_TOKEN .env | cut -d= -f2)
curl -s -X POST http://localhost:8080/admin/tools/validate \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=$ADMIN_TOKEN" \
  -d '{"url":"http://127.0.0.1/flag.txt"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['body'].strip())"
```

---

## Verifying the full attack chain works

```bash
cd tests
npm install && npx tsc

export ADMIN_SESSION_TOKEN=$(grep ADMIN_SESSION_TOKEN ../.env | cut -d= -f2)
export APP_URL=http://localhost:8080

# Clear DB first
docker compose exec mongo mongosh \
  --username "$(grep MONGO_INITDB_ROOT_USERNAME ../.env | cut -d= -f2)" \
  --password "$(grep MONGO_INITDB_ROOT_PASSWORD ../.env | cut -d= -f2)" \
  --authenticationDatabase admin \
  "$(grep MONGO_INITDB_DATABASE ../.env | cut -d= -f2)" \
  --quiet --eval "db.messages.deleteMany({}); db.captures.deleteMany({})"

node --test dist/authentication.test.js dist/authorization.test.js \
     dist/ssrf.test.js dist/network-isolation.test.js

node --test dist/xss.test.js

node --test dist/attack-chain.test.js
```

All 45 tests must pass.

---

## Inspecting captured sessions

```bash
docker compose exec mongo mongosh \
  --username "$(grep MONGO_INITDB_ROOT_USERNAME .env | cut -d= -f2)" \
  --password "$(grep MONGO_INITDB_ROOT_PASSWORD .env | cut -d= -f2)" \
  --authenticationDatabase admin \
  "$(grep MONGO_INITDB_DATABASE .env | cut -d= -f2)" \
  --quiet --eval "db.captures.find().forEach(c => print(JSON.stringify(c)))"
```

---

## Inspecting the job queue

```bash
# Jobs waiting to be processed
docker compose exec ssrf-worker ls /var/queue/jobs/

# Completed results
docker compose exec ssrf-worker ls /var/queue/results/
```

---

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Admin bot gets 403 on `/admin/chat` | Web container restarted, new `ADMIN_SESSION_TOKEN` | Restart admin-bot: `docker compose restart admin-bot` |
| SSRF job times out | Queue volume not shared | Check both `web` and `ssrf-worker` have `/var/queue` mounted |
| Map viewer blank | Browser cache / CSP | Hard refresh `Ctrl+Shift+R` |
| Player gets 302 after NoSQL injection | Old browser behavior | The 302 carries the `Set-Cookie` — copy the cookie value and proceed |
| XSS payload not capturing | Old messages with broken payloads | Clear DB and retry |
| `flag-service` not found | Obsolete hostname | Use `http://127.0.0.1/flag.txt` not `flag-service:8080` |
