import { Request, Response, NextFunction } from 'express';

// ── Administrator session middleware ─────────────────────────────────────────
// The admin session token is a single cryptographically random value
// generated at instance startup and injected only into the admin bot.
// No login endpoint, no password, no derivation from customer sessions.

const ADMIN_TOKEN = process.env.ADMIN_SESSION_TOKEN;

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 32) {
  console.error('[admin] ADMIN_SESSION_TOKEN is missing or too short — aborting');
  process.exit(1);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['admin_session'];
  if (!token || token !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  req.isAdmin = true;
  next();
}

export function requireAdminPage(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['admin_session'];
  if (!token || token !== ADMIN_TOKEN) {
    res.status(403).send(renderForbidden());
    return;
  }
  req.isAdmin = true;
  next();
}

function renderForbidden(): string {
  return `<!DOCTYPE html><html><head><title>403 Forbidden</title></head>
<body><h1>403 Forbidden</h1><p>Administrator access required.</p></body></html>`;
}
