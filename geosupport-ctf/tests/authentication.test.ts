import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { post, get, extractCookie, BASE_URL } from './helpers';

describe('Authentication', () => {

  test('login page is reachable', async () => {
    const res = await get('/login');
    assert.equal(res.status, 200, 'Login page should return 200');
    const body = await res.text();
    assert.ok(body.includes('Sign in'), 'Login page should contain sign-in form');
  });

  test('valid NoSQL injection bypasses authentication', async () => {
    // Player submits MongoDB operator — $gt: "" matches any non-empty value
    const res = await post('/login', {
      email:    { $gt: '' },
      password: { $gt: '' },
    });
    // Server returns 200 with an inline redirect page (not a 302),
    // so the cookie is visible in the same response in Burp/curl.
    assert.equal(res.status, 200, 'Should return 200 on successful login');
    const cookie = extractCookie(res, 'session');
    assert.ok(cookie, 'Should set a session cookie');
    // Confirm the response body contains the redirect instruction
    const body = await res.text();
    assert.ok(
      body.includes('/dashboard'),
      'Response should redirect to /dashboard'
    );
  });

  test('wrong credentials return 401', async () => {
    const res = await post('/login', {
      email: 'nobody@example.com',
      password: 'wrongpassword',
    });
    assert.equal(res.status, 401, 'Should return 401 for bad credentials');
  });

  test('missing body fields return 400', async () => {
    const res = await post('/login', {});
    assert.equal(res.status, 400, 'Should return 400 for missing fields');
  });

  test('NoSQL injection does NOT return an admin session cookie', async () => {
    const res = await post('/login', {
      email:    { $gt: '' },
      password: { $gt: '' },
    });
    // admin_session must NOT be set
    const adminCookie = extractCookie(res, 'admin_session');
    assert.equal(adminCookie, null, 'NoSQL injection must not yield an admin_session cookie');
  });

  test('no public registration endpoint', async () => {
    const res = await post('/register', { email: 'test@test.com', password: 'x' });
    assert.ok([404, 405].includes(res.status), 'Registration endpoint should not exist');
  });

  test('no password-reset endpoint', async () => {
    const res = await post('/reset', { email: 'alice@geosupport.local' });
    assert.ok([404, 405].includes(res.status), 'Password-reset endpoint should not exist');
  });

});
