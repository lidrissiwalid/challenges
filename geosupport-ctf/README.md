# GeoSupport CTF

A realistic web exploitation CTF challenge built on a fictional GIS customer support platform.

**Difficulty:** Medium–Hard  
**Category:** Web  
**Flag format:** `IGT{...}`

---

## Challenge Description

> Welcome to GeoSupport. Our customer support platform helps GIS professionals manage map data sources and get technical assistance.
>
> An account has been provisioned for you. Find a way in and retrieve the hidden flag.
>
> **Target:** `http://<host>:<port>`

The description given to players ends here. Do not reveal the vulnerability categories.

---

## Attack Chain (spoiler — maintainers only)

```
NoSQL Injection → Stored XSS → Session Hijacking → SSRF → Flag
```

Full walkthrough: [`docs/attack-chain.md`](docs/attack-chain.md)

---

## Run Locally

The challenge runs as five Docker containers. You do not need to install Node.js
or MongoDB on your computer to run it.

### 1. Install the prerequisites

| Tool | Minimum version |
|------|----------------|
| Docker Engine | 24+ |
| Docker Compose plugin | v2+ |
| Git | any recent version |
| Bash, `curl`, and `openssl` | any recent version |

Linux is recommended. On Windows, run the commands below from WSL2 with Docker
Desktop's WSL integration enabled. macOS users can use Docker Desktop.

Confirm that Docker is running:

```bash
docker --version
docker compose version
```

If either command fails, install/start Docker before continuing.

### 2. Download the project

If you are cloning it from GitHub:

```bash
git clone https://github.com/<your-username>/geosupport-ctf.git
cd geosupport-ctf
```

If the project is already on your computer, open a terminal in its root folder—the
folder containing `docker-compose.yml`—and run:

```bash
cd /path/to/geosupport-ctf
```

### 3. Create the local configuration

For a normal local instance, let the setup script configure the challenge flag
and generate all required secrets:

```bash
bash scripts/init-instance.sh
```

The default challenge flag is `IGT{n0sql_xss_ssrf_pwn3d}`. To override it for a
separate test instance:

```bash
FLAG='IGT{your_local_test_flag}' bash scripts/init-instance.sh
```

The script creates a private `.env` file. This file contains the flag and other
secrets, is ignored by Git, and must never be committed or shared.

If `.env` already exists, do not run the initialization script again. Use the
existing file, or follow the full reset instructions below.

### 4. Build and start the challenge

```bash
bash scripts/start.sh
```

The first build downloads Docker images and Chromium, so it can take several
minutes. The script returns when the web application is ready.

Open the challenge in your browser:

```text
http://localhost:8080
```

You should see the GeoSupport sign-in page. You can also verify it from the
terminal:

```bash
curl -I http://localhost:8080/login
docker compose ps
```

`docker compose ps` should show these services running: `nginx`, `web`, `mongo`,
`admin-bot`, and `ssrf-worker`.

### 5. View logs

To follow logs from the complete stack:

```bash
docker compose logs -f
```

To inspect one service only:

```bash
docker compose logs -f web
docker compose logs -f admin-bot
docker compose logs -f ssrf-worker
```

Press `Ctrl+C` to stop following logs; this does not stop the containers.

### Stop and resume

Stop the containers without deleting the database:

```bash
docker compose stop
```

Resume the same instance:

```bash
docker compose start
```

Customer login sessions are held in memory, so restarting the `web` container
requires players to sign in again.

### Use a different local port

Set the port when creating a new instance:

```bash
PUBLIC_PORT=8081 bash scripts/init-instance.sh
bash scripts/start.sh
```

Then open `http://localhost:8081`.

### Full reset or removal

The cleanup script stops the challenge and deletes its Docker volumes, including
the challenge database:

```bash
bash scripts/cleanup.sh
```

To create a completely fresh instance with new secrets and a new flag:

```bash
bash scripts/cleanup.sh
rm .env
bash scripts/init-instance.sh
bash scripts/start.sh
```

Only remove `.env` when you intentionally want to replace the current instance
configuration.

### Common startup problems

- **Docker daemon is not running:** start Docker Desktop or the Docker service,
  then retry `docker compose ps`.
- **Port 8080 is already in use:** create the instance with another
  `PUBLIC_PORT`, such as `8081`.
- **The application does not become ready:** run `docker compose ps` and
  `docker compose logs --tail=100 web mongo nginx`.
- **A build was interrupted:** rerun `bash scripts/start.sh`; Docker reuses the
  completed build layers.
- **Old containers conflict with this project:** run `bash scripts/cleanup.sh`
  and initialize a fresh instance.

---

## Project Structure

```
geosupport-ctf/
├── docker-compose.yml          # Orchestration and network isolation
├── .env.example                # Environment variable template
├── scripts/
│   ├── init-instance.sh        # Generate secrets and flag
│   ├── start.sh                # Build and start
│   └── cleanup.sh              # Stop and destroy
├── reverse-proxy/              # Nginx — sole public entry point
├── web/                        # Node.js + Express + TypeScript application
│   ├── src/
│   │   ├── auth/               # Login route (NoSQL injection sink)
│   │   ├── chat/               # Support tickets + XSS capture inbox
│   │   ├── admin/              # Admin dashboard + SSRF endpoint
│   │   ├── middleware/         # Session and admin auth guards
│   │   ├── database/           # MongoDB models and seed
│   │   └── services/           # File-based job queue
│   └── public/                 # Static assets (CSS, JS, Leaflet)
├── admin-bot/                  # Playwright bot — simulates admin reviewing tickets
├── ssrf-worker/                # Processes URL-fetch jobs + serves flag on 127.0.0.1:80
├── tests/                      # Integration test suite (45 tests)
└── docs/                       # Full documentation
```

---

## Documentation

| Document | Audience | Content |
|----------|----------|---------|
| [`docs/deployment.md`](docs/deployment.md) | CTF organisers | Full deployment and configuration guide |
| [`docs/architecture.md`](docs/architecture.md) | CTF organisers | Network topology, service roles, session model |
| [`docs/attack-chain.md`](docs/attack-chain.md) | **Maintainers only** | Step-by-step exploitation walkthrough |
| [`docs/security-boundaries.md`](docs/security-boundaries.md) | CTF organisers | Intentional vs. defensive controls |
| [`docs/maintainer-guide.md`](docs/maintainer-guide.md) | CTF organisers | Day-to-day operation, monitoring, reset |

---

## Running the Tests

```bash
cd tests
npm install
npx tsc

export ADMIN_SESSION_TOKEN=$(grep ADMIN_SESSION_TOKEN ../.env | cut -d= -f2)
export APP_URL=http://localhost:8080

# Phase 1 — fast tests (auth, authz, SSRF, network isolation)
node --test dist/authentication.test.js dist/authorization.test.js \
     dist/ssrf.test.js dist/network-isolation.test.js

# Phase 2 — XSS capture (waits for admin bot ~8s)
node --test dist/xss.test.js

# Phase 3 — full end-to-end attack chain
node --test dist/attack-chain.test.js
```

All 45 tests must pass before deploying to players.

---

## License

MIT — see [`LICENSE`](LICENSE)
