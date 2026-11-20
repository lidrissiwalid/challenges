import { Router, Request, Response } from 'express';
import { requireAdmin, requireAdminPage } from '../middleware/admin';
import { Message } from '../database/models';
import { enqueueJob, pollResult } from '../services/queue';

const router = Router();

// GET /admin — redirect to dashboard
router.get('/', requireAdminPage, (_req: Request, res: Response) => {
  res.redirect('/admin/dashboard');
});

// GET /admin/dashboard
router.get('/dashboard', requireAdminPage, (_req: Request, res: Response) => {
  res.send(renderAdminDashboard());
});

// GET /admin/chat — message review (intentionally renders content unsafely)
// Only shows messages not yet visited by the admin, so each XSS payload
// fires exactly once against its own message and cannot bleed into others.
router.get('/chat', requireAdminPage, async (_req: Request, res: Response) => {
  const messages = await Message.find({ visitedByAdmin: false }).sort({ createdAt: -1 }).lean();
  res.send(renderAdminChat(messages));
});

// POST /admin/chat/mark-visited — called by the bot to flag a message reviewed
router.post('/chat/mark-visited', requireAdmin, async (req: Request, res: Response) => {
  const { messageId } = req.body as { messageId?: string };
  if (!messageId) { res.status(400).json({ error: 'Missing messageId' }); return; }
  await Message.updateOne({ _id: messageId }, { $set: { visitedByAdmin: true } });
  res.json({ ok: true });
});

// GET /admin/tools — Map Data Source Validator
router.get('/tools', requireAdminPage, (_req: Request, res: Response) => {
  res.send(renderAdminTools(null, null));
});

// POST /admin/tools/validate — SSRF entry point
// Only admins can reach this. The URL is forwarded to the SSRF worker via queue.
router.post('/tools/validate', requireAdmin, async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL is required.' });
    return;
  }

  // Permit only http and https schemes — block file, ftp, gopher, etc.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL.' });
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.status(400).json({ error: 'Only HTTP and HTTPS URLs are permitted.' });
    return;
  }

  try {
    const jobId = enqueueJob(url);
    const result = await pollResult(jobId);
    res.json(result);
  } catch (err) {
    console.error('[admin/tools] SSRF job error:', err);
    res.status(500).json({ error: 'Request failed or timed out.' });
  }
});

// ── HTML templates ────────────────────────────────────────────────────────────

function adminNav(): string {
  return `<nav class="navbar navbar-admin">
    <div class="nav-brand">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="28" height="28">
        <circle cx="24" cy="24" r="22" fill="#c0392b" opacity="0.9"/>
        <path d="M24 10 C16 10 10 16 10 24 C10 32 16 38 24 38 C32 38 38 32 38 24 C38 16 32 10 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
        <path d="M10 24 L38 24 M24 10 C20 16 20 32 24 38 C28 32 28 16 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
      </svg>
      <span>GeoSupport Admin</span>
    </div>
    <div class="nav-links">
      <a href="/admin/dashboard">Dashboard</a>
      <a href="/admin/chat">Support Chat</a>
      <a href="/admin/tools">Tools</a>
    </div>
  </nav>`;
}

function renderAdminDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport Admin — Dashboard</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page admin-page">
  ${adminNav()}
  <main class="container">
    <div class="page-header">
      <h1>Administrator Dashboard</h1>
      <p class="subtitle">GeoSupport Operations Center</p>
    </div>
    <div class="dashboard-grid">
      <a href="/admin/chat" class="dashboard-card">
        <div class="card-icon">💬</div>
        <h3>Support Chat</h3>
        <p>Review customer support tickets</p>
      </a>
      <a href="/admin/tools" class="dashboard-card">
        <div class="card-icon">🔧</div>
        <h3>Map Data Source Validator</h3>
        <p>Validate external GIS data source endpoints</p>
      </a>
    </div>
  </main>
</body>
</html>`;
}

function renderAdminChat(
  messages: Array<{ _id: object; customerEmail: string; subject: string; content: string; createdAt: Date; visitedByAdmin: boolean }>
): string {
  // ── Intentional XSS vulnerability ──────────────────────────────────────────
  // Message content is inserted with innerHTML, NOT textContent.
  // This is deliberate: the admin chat must execute stored XSS payloads.
  // The customer-facing support page uses escapeHtml() for safe rendering.
  // ───────────────────────────────────────────────────────────────────────────
  const rows = messages.length === 0
    ? '<p class="empty-state">No tickets to review.</p>'
    : messages.map(m => `
      <div class="message-card ${m.visitedByAdmin ? 'reviewed' : 'unread'}" data-id="${escapeAttr((m._id as object).toString())}">
        <div class="message-header">
          <span class="from">${escapeHtml(m.customerEmail)}</span>
          <span class="date">${new Date(m.createdAt).toLocaleString()}</span>
          <span class="badge ${m.visitedByAdmin ? 'badge-reviewed' : 'badge-pending'}">${m.visitedByAdmin ? 'Reviewed' : 'Pending'}</span>
        </div>
        <div class="message-subject">${escapeHtml(m.subject)}</div>
        <div class="message-body" data-message-id="${escapeAttr((m._id as object).toString())}"><!-- content injected by JS --></div>
      </div>`).join('');

  // The message content is embedded as a JSON blob and injected via innerHTML
  // in admin-chat.js.  This is the intentional sink.
  // Escape </script> sequences to prevent premature script tag termination.
  const messagesJson = JSON.stringify(
    messages.map(m => ({
      id: (m._id as object).toString(),
      content: m.content,
    }))
  ).replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport Admin — Support Chat</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page admin-page">
  ${adminNav()}
  <main class="container">
    <div class="page-header">
      <h1>Customer Support Chat</h1>
      <p class="subtitle">Review and manage customer tickets</p>
    </div>
    <div id="messageList">${rows}</div>
  </main>
  <script>
    // Message data embedded server-side — content rendered unsafely (intentional)
    window.__MESSAGES__ = ${messagesJson};
  </script>
  <script src="/js/admin-chat.js"></script>
</body>
</html>`;
}

function renderAdminTools(result: object | null, error: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport Admin — Map Data Source Validator</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page admin-page">
  ${adminNav()}
  <main class="container">
    <div class="page-header">
      <h1>Map Data Source Validator</h1>
      <p class="subtitle">Validate external GIS data source endpoints for compatibility and availability</p>
    </div>
    <div class="card">
      <h2>Validate Endpoint</h2>
      <p>Enter the URL of a GIS data source (WMS, WFS, or REST API) to check its availability and configuration.</p>
      <form id="validatorForm">
        <div class="form-group">
          <label for="url">Data Source URL</label>
          <input type="text" id="url" name="url" placeholder="https://gis.example.com/wms?SERVICE=WMS&REQUEST=GetCapabilities" required>
        </div>
        <button type="submit" class="btn btn-primary">Validate Source</button>
      </form>
      <div id="validatorResult" class="mt-3"></div>
    </div>
    <div class="card mt-3">
      <h2>Supported Source Types</h2>
      <table class="data-table">
        <thead><tr><th>Protocol</th><th>Format</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>WMS 1.3.0</td><td>XML / GetCapabilities</td><td><span class="badge badge-reviewed">Supported</span></td></tr>
          <tr><td>WFS 2.0</td><td>GeoJSON / GetFeature</td><td><span class="badge badge-reviewed">Supported</span></td></tr>
          <tr><td>REST / GeoServer</td><td>JSON</td><td><span class="badge badge-reviewed">Supported</span></td></tr>
          <tr><td>TileJSON</td><td>JSON</td><td><span class="badge badge-pending">Beta</span></td></tr>
        </tbody>
      </table>
    </div>
  </main>
  <script src="/js/admin-tools.js"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function escapeAttr(s: string): string {
  return String(s).replace(/[^a-z0-9_-]/gi, '');
}

export default router;
