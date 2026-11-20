import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { connectDatabase } from './database/connection';
import { seedDatabase } from './database/seed';
import { ensureQueueDirs } from './services/queue';
import authRouter from './auth/router';
import chatRouter from './chat/router';
import adminRouter from './admin/router';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Security headers ──────────────────────────────────────────────────────────
// The default CSP is applied to all routes EXCEPT the admin chat page.
// The admin chat page intentionally has a relaxed CSP so that the stored XSS
// vulnerability (the designed challenge stage) actually executes in the browser.
app.use((req, res, next) => {
  // Admin chat page — deliberately weak CSP, this is the XSS target
  if (req.path === '/admin/chat') {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:    ["'self'"],
          scriptSrc:     ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc:      ["'self'", "'unsafe-inline'"],
          imgSrc:        ['*', 'data:'],
          connectSrc:    ['*'],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    })(req, res, next);
  }

  // Map viewer — Leaflet sets inline styles on its panes so style-src needs
  // 'unsafe-inline'. Tiles come from OSM, CARTO and Esri.
  if (req.path === '/map') {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:    ["'self'"],
          scriptSrc:     ["'self'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          // Leaflet sets inline styles via JS (transform, z-index, opacity…)
          styleSrc:      ["'self'", "'unsafe-inline'"],
          imgSrc:        [
            "'self'", 'data:',
            'https://*.basemaps.cartocdn.com',
            'https://server.arcgisonline.com',
          ],
          connectSrc:    ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    })(req, res, next);
  }

  // All other pages — strict default CSP
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:    ["'self'"],
        scriptSrc:     ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc:      ["'self'"],
        imgSrc:        ["'self'", 'data:'],
        connectSrc:    ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: false,
  })(req, res, next);
});

// ── Body parsing ──────────────────────────────────────────────────────────────
// Accept JSON and URL-encoded bodies.
// The login endpoint receives JSON — this is required for the NoSQL injection.
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(cookieParser());

// ── Trust proxy (Nginx sits in front) ────────────────────────────────────────
app.set('trust proxy', 1);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/login', authLimiter);

// ── Static assets ─────────────────────────────────────────────────────────────
// Source maps are disabled in tsconfig; no .ts files are served.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  dotfiles: 'deny',
  etag: true,
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/login'));
app.use('/', authRouter);
app.use('/', chatRouter);
app.use('/admin', adminRouter);

// 404
app.use((_req, res) => {
  res.status(404).send('<h1>404 Not Found</h1>');
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).send('<h1>500 Internal Server Error</h1>');
});

// ── Startup ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    await connectDatabase();
    await seedDatabase();
    ensureQueueDirs();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[web] Listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('[web] Startup failed:', err);
    process.exit(1);
  }
})();
