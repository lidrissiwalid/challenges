# Deployment Guide

## Requirements

| Tool | Version |
|------|---------|
| Docker Engine | 24+ |
| Docker Compose plugin | v2+ |
| `openssl` | any recent |
| Linux host | recommended (iptables-based network isolation) |
| Outbound internet on host | required (admin-bot needs it for webhook exfiltration) |

---

## First deployment

### 1. Clone the repository

```bash
git clone <repo> geosupport-ctf
cd geosupport-ctf
```

### 2. Initialise the instance

```bash
# With a custom flag:
FLAG="IGT{your_flag_here}" bash scripts/init-instance.sh

# Or let the script generate a random flag:
bash scripts/init-instance.sh
```

`init-instance.sh` creates `.env` with:
- Random MongoDB credentials
- Random `APP_SECRET`
- Random `ADMIN_SESSION_TOKEN` (96-hex-char, never exposed publicly)
- Random seed user password
- Your flag

The flag and admin token are printed to stdout — **save them**.

### 3. Build and start

```bash
bash scripts/start.sh
```

This builds all images and starts the five-container stack. The challenge is ready when the script prints:

```
[start] Application is ready at http://localhost:8080
```

### 4. Verify

```bash
curl -s http://localhost:8080/login | grep "GeoSupport"
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `MONGO_INITDB_ROOT_USERNAME` | MongoDB root username |
| `MONGO_INITDB_ROOT_PASSWORD` | MongoDB root password (random) |
| `MONGO_INITDB_DATABASE` | MongoDB database name |
| `APP_SECRET` | General application secret |
| `ADMIN_SESSION_TOKEN` | Admin session token — installed in bot only, never sent to players |
| `SEED_USER_EMAIL` | Email of the seeded customer account |
| `SEED_USER_PASSWORD` | Password of the seeded customer (not needed by players) |
| `FLAG` | The challenge flag |
| `QUEUE_PATH` | Queue volume mount path (default `/var/queue`) |
| `PUBLIC_PORT` | Host port exposed by Nginx (default `8080`) |

---

## Changing the flag

Edit `.env`:
```bash
nano .env
# Change: FLAG=IGT{new_flag_here}
```

Restart only the ssrf-worker (the only service that reads `FLAG`):
```bash
docker compose up -d ssrf-worker
```

---

## Multi-instance deployment

Each team needs its own stack with a unique port and project name:

```bash
# Team 1
COMPOSE_PROJECT_NAME=team01 PUBLIC_PORT=8080 \
  FLAG="IGT{team01_flag}" bash scripts/init-instance.sh
COMPOSE_PROJECT_NAME=team01 docker compose up -d

# Team 2
cp .env /tmp/team01.env   # backup
rm .env
COMPOSE_PROJECT_NAME=team02 PUBLIC_PORT=8081 \
  FLAG="IGT{team02_flag}" bash scripts/init-instance.sh
COMPOSE_PROJECT_NAME=team02 docker compose up -d
```

Each instance has completely separate containers, networks, volumes, and flags.

---

## Network architecture

```
Player browser
      │
      ▼  (host port 8080)
  [nginx]  ──── proxy-net ────► [web:3000]
                                    │
                          app-net ──┤──► [mongo:27017]
                                    │
                          bot-net ──┘◄── [admin-bot]
                                    │
                              queue volume
                                    │
                                    ▼
                             [ssrf-worker]
                                    │
                              flag-net (internal)
                                    │
                              127.0.0.1:80
                              (flag server on
                               worker loopback)
```

**Key isolation properties:**
- `proxy-net`: nginx ↔ web only
- `app-net`: web ↔ mongo, internal (no internet)
- `bot-net`: admin-bot ↔ web, internet-enabled (needed for webhook exfiltration)
- `flag-net`: ssrf-worker only, internal (no internet, no other services)
- The flag is served on `127.0.0.1:80` inside the ssrf-worker container — unreachable from any other container

---

## Ports published to host

| Port | Service |
|------|---------|
| `PUBLIC_PORT` (default 8080) | Nginx (player-facing) |

No other ports are published. MongoDB, the admin bot, the SSRF worker, and the flag server are all inaccessible from outside Docker.

---

## Host firewall recommendations

Docker Compose network isolation is enforced by iptables rules that Docker manages. For production CTF deployments, add these rules as defence in depth:

```bash
# Block direct access to MongoDB from outside Docker
iptables -I DOCKER-USER -p tcp --dport 27017 -j DROP

# Block access to any internal Docker bridge networks from the host
# (adjust subnet to match your Docker bridge range)
iptables -I INPUT -s 172.16.0.0/12 -j DROP
```

---

## Teardown

```bash
bash scripts/cleanup.sh
```

Stops all containers and removes all volumes including the MongoDB data. The `.env` file is preserved.

To fully reset including the flag:
```bash
bash scripts/cleanup.sh
rm .env
FLAG="IGT{new_flag}" bash scripts/init-instance.sh
bash scripts/start.sh
```

---

## Troubleshooting

**Admin bot not capturing cookies:**
```bash
docker compose logs admin-bot
```
Expected output every 8 seconds:
```
[bot] Visiting http://web:3000/admin/chat
[bot] Visit complete (marked N message(s) visited)
```

**SSRF jobs timing out:**
```bash
docker compose logs ssrf-worker
```
Check that the queue volume is mounted in both `web` and `ssrf-worker`:
```bash
docker compose exec web ls /var/queue/jobs
docker compose exec ssrf-worker ls /var/queue/jobs
```

**Flag server not responding:**
```bash
docker compose logs ssrf-worker | grep "Flag server"
# Expected: [worker] Flag server listening on 127.0.0.1:80
```

**Customer sessions lost after restart:**  
Customer sessions are in-memory in the web container. Restarting `web` invalidates all active sessions — players need to log in again via NoSQL injection.
