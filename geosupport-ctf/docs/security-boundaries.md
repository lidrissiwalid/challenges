# Security Boundaries

## Intentional vulnerabilities

| ID | Location | Vulnerability | Required for |
|----|----------|--------------|-------------|
| V1 | `POST /login` | NoSQL injection — raw body passed to `findOne()` | Stage 1 |
| V2 | `/admin/chat` JS | `innerHTML` without sanitisation | Stage 2 |
| V3 | `admin_session` cookie | `HttpOnly=false` — readable by JavaScript | Stage 3 |
| V4 | `POST /admin/tools/validate` | SSRF — server-side URL fetch with no IP/host restriction | Stage 5 |

## Intentional security controls

| Control | Purpose |
|---------|---------|
| Administrators not in `customers` collection | NoSQL injection cannot escalate to admin |
| `escapeHtml()` on all customer-facing templates | XSS executes only in the admin view |
| Admin session is a random static token with no login UI | No credential to guess or brute-force |
| Admin session not derivable from customer session | Complete privilege separation |
| Bot marks messages visited after each visit | Each XSS payload fires exactly once — no bleed between submissions |
| `script-src-attr 'none'` on customer pages | Inline event handlers blocked on support pages |
| SSRF worker only on `flag-net` (internal) | Limits SSRF blast radius — no internet, no other services |
| Flag server on worker loopback only | Only reachable via SSRF through the worker |
| No published ports on worker or flag server | Player cannot reach flag directly |
| Redirect disabled in SSRF worker | Prevents redirect chains |
| Response size capped at 128 KB | Prevents memory exhaustion |
| Request timeout of 10 seconds | Prevents slow-loris against SSRF worker |

## Known design decisions

**`bot-net` has internet access.** This is required for XSS payloads to exfiltrate cookies to external webhooks (e.g. webhook.site). The bot navigates only to `http://web:3000/admin/chat` — full-page navigations to external origins are blocked in the bot's route filter. Sub-resource requests (fetch, XHR) to external URLs are allowed.

**Admin session is static per instance.** The token does not rotate during the instance lifetime. This is by design — a rotating token would prevent the XSS → capture → reuse flow from working.

**Customer sessions are in-memory.** Sessions are lost if the web container restarts. For CTF use this is acceptable; production would use Redis.

**No TLS in development.** The challenge runs over HTTP. For external CTF exposure, place a TLS-terminating load balancer or Nginx HTTPS proxy in front.

**`SYS_ADMIN` capability on admin-bot.** Required by Chromium's in-process sandbox. The container has no internet capability (see above) and mounts no sensitive host paths.

## What cannot be exploited

- NoSQL injection cannot authenticate as administrator — admins are not in `customers`
- There are no administrator credentials anywhere in the codebase, frontend, logs, or environment
- There is no password-reset or registration endpoint
- The `/capture` endpoint cannot be used to read other players' captures (ownership enforced by `customerId`)
- The admin bot will not navigate to arbitrary URLs submitted by players
- The SSRF worker cannot reach MongoDB, the web application, Nginx, or the public internet
- The flag does not exist in the web container, its static files, its logs, or its environment variables
