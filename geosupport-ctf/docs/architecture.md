# Architecture

## Services

| Service | Image | Role |
|---------|-------|------|
| `nginx` | nginx:1.27-alpine | Reverse proxy — sole public entry point |
| `web` | custom (Node 22 + Express + TypeScript) | Main application |
| `mongo` | mongo:7.0 | Customer and message database |
| `admin-bot` | custom (Node 22 + Playwright + Chromium) | Simulates admin reviewing support tickets |
| `ssrf-worker` | custom (Node 22) | Processes URL-fetch jobs; hosts flag on loopback |

The old `flag-service` container has been merged into `ssrf-worker`. The flag is served on `127.0.0.1:80` inside the worker's own network namespace, making `http://127.0.0.1/flag.txt` the natural SSRF target.

---

## Network topology

```
Internet
    │
    ▼  (host port 8080)
[nginx]
    │  proxy-net
    ▼
[web:3000]
    ├── app-net (internal) ──► [mongo:27017]
    ├── bot-net ◄────────────── [admin-bot]
    │
    │  (queue volume — no TCP connection)
    ▼
[ssrf-worker]
    │  flag-net (internal, no internet)
    └── 127.0.0.1:80  ← flag server (loopback only)
```

## Network access matrix

| Source | Destination | Access | Via |
|--------|-------------|--------|-----|
| Player | nginx:8080 | ✅ | host port |
| nginx | web:3000 | ✅ | proxy-net |
| web | mongo:27017 | ✅ | app-net |
| web | ssrf-worker | ❌ | — (volume only) |
| web | 127.0.0.1 (flag) | ❌ | — (different container) |
| admin-bot | web:3000 | ✅ | bot-net |
| admin-bot | mongo | ❌ | — (not on app-net) |
| admin-bot | internet | ✅ | bot-net (external) |
| ssrf-worker | 127.0.0.1:80 | ✅ | loopback |
| ssrf-worker | web | ❌ | — (not on proxy-net/app-net) |
| ssrf-worker | mongo | ❌ | — (not on app-net) |
| ssrf-worker | internet | ❌ | flag-net is internal |
| Player | mongo | ❌ | not published |
| Player | 127.0.0.1 (flag) | ❌ | not published, different namespace |

---

## Queue communication

The web application and SSRF worker communicate through a Docker-managed volume at `/var/queue`:

```
web  ──writes──► /var/queue/jobs/<uuid>.json
ssrf-worker ──reads──► processes job ──writes──► /var/queue/results/<uuid>.json
web  ──reads──► /var/queue/results/<uuid>.json  ──► HTTP response to player
```

No TCP connection exists between `web` and `ssrf-worker`. The worker polls every 500ms.

---

## Session model

### Customer sessions
- Stored in-memory (`Map<token, CustomerSession>`) in the web process
- Token: 32 random bytes (hex)
- Cookie: `session=<token>; HttpOnly; SameSite=Strict`
- Lost if the web container restarts

### Admin session
- Single static token from `ADMIN_SESSION_TOKEN` env var (48 random bytes, 96 hex chars)
- No login UI — the token is installed directly into the admin bot's browser via Playwright `addCookies()`
- Cookie: `admin_session=<token>; HttpOnly=false; SameSite=Strict`
- `HttpOnly=false` is **intentional** — this is the XSS target
- Never sent over the network at startup, never logged, never in a database

---

## Database collections

| Collection | Purpose | Note |
|-----------|---------|------|
| `customers` | Seeded user accounts | Target of NoSQL injection — no admins stored here |
| `messages` | Support tickets | Content stored raw — rendered unsafely in admin view only |
| `captures` | XSS-stolen admin cookies | Readable only by the message owner |

---

## Admin bot behaviour

1. Starts Chromium and installs the `admin_session` cookie directly into the browser context
2. Every 8 seconds: navigates to `http://web:3000/admin/chat`
3. The page loads `window.__MESSAGES__` (unvisited messages only)
4. `admin-chat.js` sets `innerHTML` on each message body div → XSS executes
5. After the page reaches `networkidle`, the bot reads all `[data-message-id]` elements and marks each as visited via `POST /admin/chat/mark-visited`
6. Each message is shown to the bot exactly once — prevents old payloads from re-firing

---

## SSRF worker behaviour

1. Polls `/var/queue/jobs/` every 500ms for new `.json` job files
2. Validates the URL scheme (`http:` or `https:` only)
3. Fetches the URL using Node's native `fetch()` with:
   - Redirects disabled
   - 10-second timeout
   - 128 KB response body limit
4. Writes the result to `/var/queue/results/<jobId>.json`
5. The flag server (`http.createServer`) runs concurrently on `127.0.0.1:80`, serving `GET /flag.txt`
