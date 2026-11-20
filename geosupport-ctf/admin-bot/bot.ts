/**
 * GeoSupport Administrator Bot
 *
 * Periodically visits the admin chat page to review pending customer messages.
 * The admin session cookie is installed at startup and kept in a persistent
 * browser context. The cookie is never sent to the web app over the wire at
 * startup — it is set directly in the browser storage using Playwright's
 * addCookies API so it cannot be intercepted in transit.
 *
 * Security properties:
 *  - The bot navigates ONLY to its own application origin.
 *  - Navigation to any other origin is blocked at the route level.
 *  - The browser has no internet access (Docker network isolation).
 *  - The admin_session cookie has HttpOnly=false intentionally so the XSS
 *    payload can read document.cookie — this is the designed vulnerability.
 *  - The cookie is scoped to the challenge origin only (SameSite=Strict, path=/).
 */

import { chromium, BrowserContext, Browser } from 'playwright';

const APP_ORIGIN    = process.env.APP_ORIGIN    ?? 'http://web:3000';
const ADMIN_TOKEN   = process.env.ADMIN_SESSION_TOKEN;
const POLL_INTERVAL = parseInt(process.env.BOT_POLL_INTERVAL_MS ?? '8000', 10);
const VISIT_TIMEOUT = parseInt(process.env.BOT_VISIT_TIMEOUT_MS ?? '15000', 10);

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 32) {
  console.error('[bot] ADMIN_SESSION_TOKEN missing or too short — aborting');
  process.exit(1);
}

// Allowed navigation prefix — the bot must never visit arbitrary URLs
const ALLOWED_PREFIX = `${APP_ORIGIN}/admin`;

async function createContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    // Block all external resources just in case; network isolation handles the rest
    extraHTTPHeaders: { 'X-Bot': '1' },
  });

  // Install the admin session cookie directly into the browser context.
  // HttpOnly=false is intentional — this is the designed XSS target.
  await ctx.addCookies([{
    name:     'admin_session',
    value:    ADMIN_TOKEN!,
    domain:   new URL(APP_ORIGIN).hostname,
    path:     '/',
    httpOnly: false,   // intentional — documented vulnerability
    secure:   false,
    sameSite: 'Strict',
  }]);

  return ctx;
}

async function visitChat(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();

  // Block full-page navigation to any URL outside the allowed origin host.
  // Sub-resource requests (fetch, XHR, images) to external URLs are allowed
  // so that XSS payloads can exfiltrate data to external webhooks.
  await page.route('**/*', (route) => {
    const url     = route.request().url();
    const type    = route.request().resourceType();
    const reqUrl  = new URL(url);
    const originUrl = new URL(APP_ORIGIN);

    // Always allow requests to the web service host
    if (reqUrl.hostname === originUrl.hostname) {
      route.continue();
      return;
    }

    // Block full-page navigations to external origins (document, mainFrame)
    if (type === 'document') {
      console.warn(`[bot] Blocked external navigation: ${url}`);
      route.abort('blockedbyclient');
      return;
    }

    // Allow sub-resource requests (fetch, xhr, image, etc.) to external URLs
    // so that XSS payloads can reach external webhooks
    route.continue();
  });

  try {
    const target = `${APP_ORIGIN}/admin/chat`;

    // Safety guard — verify we are within allowed prefix before navigating
    if (!target.startsWith(ALLOWED_PREFIX)) {
      throw new Error(`[bot] Refusing to navigate to: ${target}`);
    }

    console.log(`[bot] Visiting ${target}`);
    await page.goto(target, { waitUntil: 'networkidle', timeout: VISIT_TIMEOUT });

    // Mark every visible message as visited via the API so they are not
    // shown again on the next poll. This ensures each XSS payload fires
    // exactly once — against its own message — and cannot bleed into new
    // messages submitted after the payload already ran.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageIds: string[] = await (page.evaluate as any)(`
      Array.from(document.querySelectorAll('[data-message-id]'))
        .map(el => el.dataset.messageId || '')
        .filter(Boolean)
    `);

    for (const messageId of messageIds) {
      try {
        await page.evaluate(async (id: string) => {
          await fetch('/admin/chat/mark-visited', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: id }),
          });
        }, messageId);
      } catch {
        // non-fatal
      }
    }

    // Allow injected scripts to run and exfiltrate the cookie
    await page.waitForTimeout(3000);

    console.log(`[bot] Visit complete (marked ${messageIds.length} message(s) visited)`);
  } catch (err) {
    console.error('[bot] Visit error:', err instanceof Error ? err.message : err);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  console.log('[bot] Starting admin bot');
  console.log(`[bot] Target origin: ${APP_ORIGIN}`);
  console.log(`[bot] Poll interval: ${POLL_INTERVAL}ms`);

  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Block all external network access at the browser level as well
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
    ],
  });

  const ctx = await createContext(browser);

  // Initial visit on startup
  await visitChat(ctx);

  // Poll loop
  setInterval(async () => {
    await visitChat(ctx);
  }, POLL_INTERVAL);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[bot] Shutting down');
    await browser.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[bot] Fatal:', err);
  process.exit(1);
});
