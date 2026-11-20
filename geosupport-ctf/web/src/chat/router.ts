import { Router, Request, Response } from 'express';
import { requireCustomer } from '../middleware/session';
import { Message, Capture } from '../database/models';

const router = Router();

// GET /dashboard
router.get('/dashboard', requireCustomer, (req: Request, res: Response) => {
  res.send(renderDashboard(req.customer!));
});

// GET /map — Map Viewer
router.get('/map', requireCustomer, (req: Request, res: Response) => {
  res.send(renderMapViewer(req.customer!));
});

// GET /export — Data Export
router.get('/export', requireCustomer, (req: Request, res: Response) => {
  res.send(renderExport(req.customer!));
});

// POST /export/request — submit an export job (functional but non-vulnerable)
router.post('/export/request', requireCustomer, (req: Request, res: Response) => {
  const { dataset, format } = req.body as { dataset?: string; format?: string };
  const validDatasets = ['osm-roads', 'elevation', 'land-use', 'hydrology', 'admin-boundaries'];
  const validFormats  = ['geojson', 'shapefile', 'csv', 'kml'];
  if (!dataset || !validDatasets.includes(dataset)) {
    res.status(400).json({ error: 'Invalid dataset.' }); return;
  }
  if (!format || !validFormats.includes(format)) {
    res.status(400).json({ error: 'Invalid format.' }); return;
  }
  // Simulate a queued job — no actual processing
  const jobId = Math.random().toString(36).slice(2, 10).toUpperCase();
  res.json({ ok: true, jobId, estimatedMinutes: Math.floor(Math.random() * 8) + 2 });
});

// GET /settings — Account Settings
router.get('/settings', requireCustomer, (req: Request, res: Response) => {
  res.send(renderSettings(req.customer!));
});

// POST /settings/profile — update display name (functional, safe)
router.post('/settings/profile', requireCustomer, (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
    res.status(400).json({ error: 'Name must be between 2 and 60 characters.' }); return;
  }
  // In a real app this would persist to the DB; here we just acknowledge it
  res.json({ ok: true, name: name.trim() });
});

// GET /support
router.get('/support', requireCustomer, async (req: Request, res: Response) => {
  // Only fetch the most recent ticket so old submissions don't pile up
  const latest = await Message.findOne({ customerId: req.customer!.customerId })
    .sort({ createdAt: -1 })
    .lean();
  res.send(renderSupport(req.customer!, latest ?? null));
});

// POST /support
router.post('/support', requireCustomer, async (req: Request, res: Response) => {
  const { subject, content } = req.body as { subject?: string; content?: string };
  if (!subject?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Subject and content are required.' }); return;
  }
  if (subject.length > 200) { res.status(400).json({ error: 'Subject too long.' }); return; }
  if (content.length > 4000) { res.status(400).json({ error: 'Content too long.' }); return; }
  const msg = await Message.create({
    customerId:    req.customer!.customerId,
    customerEmail: req.customer!.email,
    subject:       subject.trim(),
    content:       content.trim(),
  });
  res.json({ ok: true, messageId: (msg._id as object).toString() });
});

// GET /support/capture/:messageId
router.get('/support/capture/:messageId', requireCustomer, async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const msg = await Message.findOne({ _id: messageId, customerId: req.customer!.customerId }).lean();
  if (!msg) { res.status(404).json({ error: 'Message not found.' }); return; }
  const capture = await Capture.findOne({ messageId }).lean();
  if (!capture) {
    res.status(404).json({ status: 'pending', message: 'No capture yet. The administrator has not reviewed this message.' });
    return;
  }
  res.json({ status: 'captured', value: capture.capturedValue, capturedAt: capture.capturedAt });
});

// POST /capture — public, receives XSS-stolen admin cookie
router.post('/capture', async (req: Request, res: Response) => {
  const { messageId, value } = req.body as { messageId?: string; value?: string };
  if (!messageId || !value) { res.status(400).json({ error: 'Missing fields.' }); return; }
  if (typeof value !== 'string' || value.length > 512) {
    res.status(400).json({ error: 'Invalid value.' }); return;
  }
  const msg = await Message.findById(messageId).lean();
  if (!msg) { res.status(404).json({ error: 'Unknown message.' }); return; }
  await Capture.updateOne(
    { messageId },
    { $setOnInsert: { messageId, customerId: msg.customerId, capturedValue: value } },
    { upsert: true }
  );
  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function navBar(name: string, active = ''): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`;
  return `<nav class="navbar">
    <div class="nav-brand">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="28" height="28">
        <circle cx="24" cy="24" r="22" fill="#1a56db" opacity="0.9"/>
        <path d="M24 10 C16 10 10 16 10 24 C10 32 16 38 24 38 C32 38 38 32 38 24 C38 16 32 10 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
        <path d="M10 24 L38 24 M24 10 C20 16 20 32 24 38 C28 32 28 16 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
      </svg>
      <span>GeoSupport</span>
    </div>
    <div class="nav-links">
      ${link('/dashboard', 'Dashboard')}
      ${link('/map', 'Map Viewer')}
      ${link('/export', 'Data Export')}
      ${link('/support', 'Support')}
      ${link('/settings', 'Settings')}
    </div>
    <div class="nav-user">
      <span>${escapeHtml(name)}</span>
      <a href="/logout" class="btn btn-secondary btn-sm">Sign out</a>
    </div>
  </nav>`;
}

// ── Page templates ────────────────────────────────────────────────────────────

function renderDashboard(session: { name: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Dashboard</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page">
  ${navBar(session.name, '/dashboard')}
  <main class="container">
    <div class="page-header">
      <h1>Welcome back, ${escapeHtml(session.name)}</h1>
      <p class="subtitle">GeoSupport Customer Portal</p>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">3</div>
        <div class="stat-label">Active Layers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">12</div>
        <div class="stat-label">Exports This Month</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">99.8%</div>
        <div class="stat-label">Service Uptime</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">2.4 GB</div>
        <div class="stat-label">Storage Used</div>
      </div>
    </div>

    <div class="dashboard-grid mt-3">
      <a href="/map" class="dashboard-card">
        <div class="card-icon">🗺️</div>
        <h3>Map Viewer</h3>
        <p>Visualize and explore your GIS layers interactively</p>
      </a>
      <a href="/export" class="dashboard-card">
        <div class="card-icon">📊</div>
        <h3>Data Export</h3>
        <p>Export datasets in GeoJSON, Shapefile, CSV or KML</p>
      </a>
      <a href="/support" class="dashboard-card">
        <div class="card-icon">💬</div>
        <h3>Support Tickets</h3>
        <p>Submit and track your support requests</p>
      </a>
      <a href="/settings" class="dashboard-card">
        <div class="card-icon">⚙️</div>
        <h3>Account Settings</h3>
        <p>Manage your profile and API access</p>
      </a>
    </div>

    <div class="card mt-3">
      <h2>Recent Activity</h2>
      <table class="data-table">
        <thead><tr><th>Event</th><th>Dataset</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Export completed</td><td>OSM Roads — North Region</td><td>2 hours ago</td><td><span class="badge badge-reviewed">Done</span></td></tr>
          <tr><td>Layer updated</td><td>Land Use Classification 2024</td><td>Yesterday</td><td><span class="badge badge-reviewed">Done</span></td></tr>
          <tr><td>Export completed</td><td>Hydrology Basin Q3</td><td>3 days ago</td><td><span class="badge badge-reviewed">Done</span></td></tr>
          <tr><td>Support ticket</td><td>Projection mismatch on EPSG:3857</td><td>5 days ago</td><td><span class="badge badge-pending">Pending</span></td></tr>
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

function renderMapViewer(session: { name: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Map Viewer</title>
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/leaflet.css"/>
  <style>
    .map-layout { display: grid; grid-template-columns: 260px 1fr; gap: 1.25rem; align-items: start; }
    #mapContainer { height: 520px; border-radius: var(--radius); border: 1px solid var(--border); }
    .layer-item { display: flex; align-items: center; gap: .6rem; padding: .5rem 0; border-bottom: 1px solid var(--border); font-size: .9rem; }
    .layer-item:last-child { border-bottom: none; }
    .layer-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .layer-name { flex: 1; }
    .toggle { width: 32px; height: 18px; background: var(--primary); border-radius: 9px; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s; }
    .toggle.off { background: var(--border); }
    .toggle::after { content: ''; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 2px; transition: left .15s; }
    .toggle.off::after { left: 2px; }
    .toggle:not(.off)::after { left: 16px; }
    .coord-box { font-size: .85rem; color: var(--muted); line-height: 1.9; }
    @media(max-width:700px){ .map-layout{ grid-template-columns:1fr; } #mapContainer{ height:340px; } }
  </style>
</head>
<body class="app-page">
  ${navBar(session.name, '/map')}
  <main class="container">
    <div class="page-header">
      <h1>Map Viewer</h1>
      <p class="subtitle">Visualize and explore your GIS datasets</p>
    </div>
    <div class="map-layout">

      <div>
        <div class="card">
          <h2>Layers</h2>
          <div id="layerList">
            <div class="layer-item">
              <div class="layer-dot" style="background:#1a56db"></div>
              <span class="layer-name">OSM Roads</span>
              <div class="toggle" data-layer="roads"></div>
            </div>
            <div class="layer-item">
              <div class="layer-dot" style="background:#16a34a"></div>
              <span class="layer-name">Land Use 2024</span>
              <div class="toggle" data-layer="landuse"></div>
            </div>
            <div class="layer-item">
              <div class="layer-dot" style="background:#0ea5e9"></div>
              <span class="layer-name">Hydrology</span>
              <div class="toggle" data-layer="hydro"></div>
            </div>
            <div class="layer-item">
              <div class="layer-dot" style="background:#f59e0b"></div>
              <span class="layer-name">Elevation (DEM)</span>
              <div class="toggle off" data-layer="dem"></div>
            </div>
            <div class="layer-item">
              <div class="layer-dot" style="background:#8b5cf6"></div>
              <span class="layer-name">Admin Boundaries</span>
              <div class="toggle off" data-layer="admin"></div>
            </div>
          </div>
        </div>

        <div class="card mt-2">
          <h2>Basemap</h2>
          <div class="form-group" style="margin-bottom:0">
            <select id="basemapSelect" style="width:100%;padding:.5rem .75rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem;">
              <option value="streets">Streets</option>
              <option value="satellite">Satellite</option>
              <option value="terrain">Terrain</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>

        <div class="card mt-2">
          <h2>Coordinates</h2>
          <div class="coord-box">
            <div>Lat: <strong id="coordLat">48.8566</strong></div>
            <div>Lon: <strong id="coordLon">2.3522</strong></div>
            <div>Zoom: <strong id="zoomLevel">10</strong></div>
            <div>Projection: <strong>EPSG:4326</strong></div>
          </div>
        </div>
      </div>

      <div id="mapContainer"></div>
    </div>
  </main>
  <script src="/js/leaflet.js"></script>
  <script src="/js/map-viewer.js"></script>
</body>
</html>`;
}

function renderExport(session: { name: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Data Export</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page">
  ${navBar(session.name, '/export')}
  <main class="container">
    <div class="page-header">
      <h1>Data Export</h1>
      <p class="subtitle">Download GIS datasets in your preferred format</p>
    </div>

    <div class="card">
      <h2>New Export Request</h2>
      <form id="exportForm">
        <div class="form-group">
          <label for="dataset">Dataset</label>
          <select id="dataset" name="dataset" required>
            <option value="">— Select a dataset —</option>
            <option value="osm-roads">OSM Roads — North Region</option>
            <option value="elevation">Elevation Model (DEM 30m)</option>
            <option value="land-use">Land Use Classification 2024</option>
            <option value="hydrology">Hydrology — Basin Network</option>
            <option value="admin-boundaries">Administrative Boundaries L2</option>
          </select>
        </div>
        <div class="form-group">
          <label for="format">Export Format</label>
          <select id="format" name="format" required>
            <option value="">— Select a format —</option>
            <option value="geojson">GeoJSON</option>
            <option value="shapefile">Shapefile (.zip)</option>
            <option value="csv">CSV (attributes only)</option>
            <option value="kml">KML / KMZ</option>
          </select>
        </div>
        <div class="form-group">
          <label>Bounding Box (optional)</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
            <input type="text" placeholder="Min Lat (e.g. 48.80)" id="minLat">
            <input type="text" placeholder="Min Lon (e.g. 2.25)" id="minLon">
            <input type="text" placeholder="Max Lat (e.g. 48.90)" id="maxLat">
            <input type="text" placeholder="Max Lon (e.g. 2.42)" id="maxLon">
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Request Export</button>
      </form>
      <div id="exportResult" class="mt-2"></div>
    </div>

    <div class="card mt-3">
      <h2>Recent Exports</h2>
      <table class="data-table">
        <thead>
          <tr><th>Dataset</th><th>Format</th><th>Requested</th><th>Size</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>OSM Roads — North Region</td><td>GeoJSON</td><td>2 hours ago</td><td>14.2 MB</td>
            <td><span class="badge badge-reviewed">Ready</span></td>
          </tr>
          <tr>
            <td>Hydrology Basin Q3</td><td>Shapefile</td><td>3 days ago</td><td>8.7 MB</td>
            <td><span class="badge badge-reviewed">Ready</span></td>
          </tr>
          <tr>
            <td>Land Use Classification 2024</td><td>KML</td><td>1 week ago</td><td>22.1 MB</td>
            <td><span class="badge badge-reviewed">Ready</span></td>
          </tr>
          <tr>
            <td>Elevation Model (DEM 30m)</td><td>Shapefile</td><td>2 weeks ago</td><td>—</td>
            <td><span class="badge badge-pending">Processing</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
  <script src="/js/export.js"></script>
</body>
</html>`;
}

function renderSettings(session: { name: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Account Settings</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="app-page">
  ${navBar(session.name, '/settings')}
  <main class="container">
    <div class="page-header">
      <h1>Account Settings</h1>
      <p class="subtitle">Manage your profile, preferences and API access</p>
    </div>

    <div class="card">
      <h2>Profile</h2>
      <form id="profileForm">
        <div class="form-group">
          <label for="displayName">Display Name</label>
          <input type="text" id="displayName" name="name" value="${escapeHtml(session.name)}" maxlength="60" required>
        </div>
        <div class="form-group">
          <label for="emailField">Email Address</label>
          <input type="text" id="emailField" value="${escapeHtml(session.email)}" disabled
            style="background:var(--bg);color:var(--muted);cursor:not-allowed;">
          <small style="color:var(--muted);">Contact support to change your email address.</small>
        </div>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </form>
      <div id="profileResult" class="mt-2"></div>
    </div>

    <div class="card mt-3">
      <h2>Preferences</h2>
      <form id="prefForm">
        <div class="form-group">
          <label for="projSelect">Default Projection</label>
          <select id="projSelect">
            <option value="4326" selected>WGS 84 (EPSG:4326)</option>
            <option value="3857">Web Mercator (EPSG:3857)</option>
            <option value="27700">British National Grid (EPSG:27700)</option>
            <option value="2154">RGF93 / Lambert-93 (EPSG:2154)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="unitSelect">Distance Units</label>
          <select id="unitSelect">
            <option value="metric" selected>Metric (km, m)</option>
            <option value="imperial">Imperial (mi, ft)</option>
            <option value="nautical">Nautical (nmi)</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;">
            <input type="checkbox" id="emailNotif" checked style="width:auto;">
            Receive email notifications for completed exports
          </label>
        </div>
        <button type="submit" class="btn btn-primary">Save Preferences</button>
      </form>
      <div id="prefResult" class="mt-2"></div>
    </div>

    <div class="card mt-3">
      <h2>API Access</h2>
      <p style="font-size:.9rem;color:var(--muted);margin-bottom:1rem;">
        Use your API key to access GeoSupport datasets programmatically via our REST API.
      </p>
      <div class="form-group">
        <label>API Key</label>
        <div style="display:flex;gap:.75rem;align-items:center;">
          <input type="password" id="apiKey" value="gs_live_••••••••••••••••••••••••••••••••" readonly
            style="flex:1;background:var(--bg);font-family:monospace;">
          <button class="btn btn-secondary" id="toggleApiKey">Show</button>
          <button class="btn btn-secondary" id="copyApiKey">Copy</button>
        </div>
      </div>
      <button class="btn btn-secondary mt-2" id="rotateKey">Rotate API Key</button>
      <div id="apiResult" class="mt-2"></div>
    </div>

    <div class="card mt-3">
      <h2>Danger Zone</h2>
      <p style="font-size:.9rem;color:var(--muted);margin-bottom:1rem;">
        These actions are irreversible. Please be certain before proceeding.
      </p>
      <button class="btn" style="background:#fef2f2;color:var(--error);border:1px solid #fecaca;" id="deleteAccount">
        Delete Account
      </button>
    </div>
  </main>
  <script src="/js/settings.js"></script>
</body>
</html>`;
}

function renderSupport(
  session: { name: string; email: string },
  latest: { _id: object; subject: string; content: string; createdAt: Date; visitedByAdmin: boolean } | null
): string {
  const ticketSection = latest
    ? `<div class="card mt-3">
      <h2>Latest Ticket</h2>
      <div class="ticket-status-banner">
        <div class="ticket-status-icon">${latest.visitedByAdmin ? '✅' : '⏳'}</div>
        <div>
          <div class="ticket-status-title">${latest.visitedByAdmin ? 'Your ticket has been reviewed' : 'Your ticket is pending review'}</div>
          <div class="ticket-status-sub">${latest.visitedByAdmin
            ? 'An administrator has reviewed your message. Thank you for contacting GeoSupport.'
            : 'An administrator will examine your ticket shortly. Please check back later.'
          }</div>
        </div>
      </div>
      <table class="data-table mt-2">
        <thead>
          <tr><th>Subject</th><th>Message preview</th><th>Submitted</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(latest.subject)}</td>
            <td class="content-preview">${escapeHtml(latest.content.slice(0, 80))}${latest.content.length > 80 ? '…' : ''}</td>
            <td style="color:var(--muted);font-size:.85rem;">${new Date(latest.createdAt).toLocaleString()}</td>
            <td><span class="badge ${latest.visitedByAdmin ? 'badge-reviewed' : 'badge-pending'}">${latest.visitedByAdmin ? 'Reviewed' : 'Pending'}</span></td>
          </tr>
        </tbody>
      </table>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Support</title>
  <link rel="stylesheet" href="/css/main.css">
  <style>
    .ticket-status-banner { display:flex; align-items:flex-start; gap:1rem; padding:1rem; background:var(--bg); border-radius:var(--radius); border:1px solid var(--border); margin-bottom:.5rem; }
    .ticket-status-icon { font-size:1.75rem; line-height:1; flex-shrink:0; }
    .ticket-status-title { font-weight:600; font-size:.95rem; margin-bottom:.2rem; }
    .ticket-status-sub { font-size:.85rem; color:var(--muted); }
  </style>
</head>
<body class="app-page">
  ${navBar(session.name, '/support')}
  <main class="container">
    <div class="page-header">
      <h1>Support</h1>
      <p class="subtitle">Submit a request and our team will get back to you</p>
    </div>

    <div class="card">
      <h2>Submit a Ticket</h2>
      <p style="font-size:.9rem;color:var(--muted);margin-bottom:1.25rem;">
        Describe your issue below. You may submit additional tickets whenever you need help.
      </p>
      <form id="ticketForm">
        <div class="form-group">
          <label for="subject">Subject</label>
          <input type="text" id="subject" name="subject" placeholder="Briefly describe your issue" maxlength="200" required>
        </div>
        <div class="form-group">
          <label for="content">Message</label>
          <textarea id="content" name="content" rows="6" placeholder="Provide as much detail as possible so our team can help you effectively…" maxlength="4000" required></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Send Ticket</button>
      </form>
      <div id="ticketResult" class="mt-2"></div>
    </div>

    ${ticketSection}

    <div id="captureModal" class="modal hidden">
      <div class="modal-content">
        <h3>Capture Result</h3>
        <div id="captureResult"></div>
        <button id="closeModal" class="btn btn-secondary mt-2">Close</button>
      </div>
    </div>
  </main>
  <script src="/js/support.js"></script>
</body>
</html>`;
}

export default router;
