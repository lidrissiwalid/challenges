import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { get, post, getWithSession, postWithSession, loginAsUser } from './helpers';

describe('Authorization', () => {

  test('unauthenticated access to /dashboard redirects to /login', async () => {
    const res = await get('/dashboard');
    assert.ok([302, 303].includes(res.status), 'Should redirect');
    assert.ok(res.headers.get('location')?.includes('/login'), 'Should redirect to /login');
  });

  test('unauthenticated access to /support redirects to /login', async () => {
    const res = await get('/support');
    assert.ok([302, 303].includes(res.status), 'Should redirect');
  });

  test('unauthenticated access to /admin returns 403', async () => {
    const res = await get('/admin');
    assert.equal(res.status, 403, '/admin should return 403 without admin session');
  });

  test('unauthenticated access to /admin/dashboard returns 403', async () => {
    const res = await get('/admin/dashboard');
    assert.equal(res.status, 403);
  });

  test('unauthenticated access to /admin/chat returns 403', async () => {
    const res = await get('/admin/chat');
    assert.equal(res.status, 403);
  });

  test('unauthenticated access to /admin/tools returns 403', async () => {
    const res = await get('/admin/tools');
    assert.equal(res.status, 403);
  });

  test('customer session cannot access /admin/dashboard', async () => {
    const session = await loginAsUser();
    const res = await getWithSession('/admin/dashboard', session);
    assert.equal(res.status, 403, 'Customer session must not access admin dashboard');
  });

  test('customer session cannot access /admin/chat', async () => {
    const session = await loginAsUser();
    const res = await getWithSession('/admin/chat', session);
    assert.equal(res.status, 403);
  });

  test('customer session cannot use SSRF endpoint', async () => {
    const session = await loginAsUser();
    const res = await postWithSession(
      '/admin/tools/validate',
      { url: 'http://flag-service:8080/' },
      session
    );
    assert.equal(res.status, 403, 'Customer must not reach SSRF endpoint');
  });

  test('POST /admin/tools/validate with no session returns 403', async () => {
    const res = await post('/admin/tools/validate', { url: 'http://flag-service:8080/' });
    assert.equal(res.status, 403);
  });

  test('fake admin_session token is rejected', async () => {
    const res = await get('/admin/dashboard', {
      headers: { Cookie: 'admin_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(res.status, 403);
  });

});
