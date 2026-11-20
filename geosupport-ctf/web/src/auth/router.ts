import { Router, Request, Response } from 'express';
import { Customer } from '../database/models';
import { createCustomerSession } from '../middleware/session';

const router = Router();

// GET /login
router.get('/login', (req: Request, res: Response) => {
  res.send(renderLogin(null));
});

// POST /login  — intentionally vulnerable to NoSQL injection.
// The JSON body is passed directly into the Mongoose findOne query without
// sanitizing operator keys.  A player can send:
//   { "email": { "$gt": "" }, "password": { "$gt": "" } }
// to bypass the password check and obtain the first customer document.
//
// Critical isolation: this query targets ONLY the Customer collection.
// Administrators are not in this collection; winning this stage always yields
// a customer session, never an administrator session.
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: unknown; password: unknown };

    if (!email || !password) {
      res.status(400).send(renderLogin('Email and password are required.'));
      return;
    }

    // ── Intentional vulnerability ──────────────────────────────────────────
    // We pass the raw values as query fields, allowing MongoDB operators.
    const customer = await Customer.findOne({ email, password });
    // ──────────────────────────────────────────────────────────────────────

    if (!customer) {
      res.status(401).send(renderLogin('Invalid credentials.'));
      return;
    }

    const token = createCustomerSession({
      customerId: (customer._id as object).toString(),
      email: customer.email,
      name: customer.name,
    });

    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });

    // Respond with 200 + an immediate client-side redirect instead of a 302.
    // A 302 requires the HTTP client to follow it in a second request, which
    // tools like Burp Suite Repeater do not do automatically after a POST.
    // A 200 with meta-refresh + JS redirect means the cookie arrives in the
    // same response the tool sees, and the browser navigates without a second
    // round-trip needed from the tool.
    res.status(200).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=/dashboard">
<title>Redirecting…</title></head>
<body>
<script>window.location.replace('/dashboard');</script>
<p>Redirecting to <a href="/dashboard">/dashboard</a>…</p>
</body></html>`);
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).send(renderLogin('An internal error occurred.'));
  }
});

// GET /logout
router.get('/logout', (req: Request, res: Response) => {
  res.clearCookie('session');
  res.redirect('/login');
});

// ── HTML templates ───────────────────────────────────────────────────────────

function renderLogin(error: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoSupport — Sign In</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="auth-page">
  <div class="auth-container">
    <div class="auth-logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
        <circle cx="24" cy="24" r="22" fill="#1a56db" opacity="0.9"/>
        <path d="M24 10 C16 10 10 16 10 24 C10 32 16 38 24 38 C32 38 38 32 38 24 C38 16 32 10 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
        <path d="M10 24 L38 24 M24 10 C20 16 20 32 24 38 C28 32 28 16 24 10Z" fill="none" stroke="white" stroke-width="1.5"/>
      </svg>
      <span>GeoSupport</span>
    </div>
    <div class="auth-card">
      <h1>Sign in to your account</h1>
      <p class="auth-subtitle">Access the GeoSupport customer portal</p>
      ${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/login" id="loginForm">
        <div class="form-group">
          <label for="email">Email address</label>
          <input type="text" id="email" name="email" placeholder="you@example.com" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Sign in</button>
      </form>
      <p class="auth-footer">Need help? Contact your GeoSupport account manager.</p>
    </div>
  </div>
  <script src="/js/login.js"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
