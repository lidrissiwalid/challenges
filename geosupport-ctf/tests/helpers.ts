import fetch, { Response, RequestInit } from 'node-fetch';

export const BASE_URL = process.env.APP_URL ?? 'http://localhost:8080';

export async function post(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  const { headers: extraHeaders, ...restInit } = init;
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...((extraHeaders as object) ?? {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
    ...restInit,
  });
}

export async function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    redirect: 'manual',
    ...init,
  });
}

/** Extract the value of a Set-Cookie header by name */
export function extractCookie(res: Response, name: string): string | null {
  const header = res.headers.raw()['set-cookie'];
  if (!header) return null;
  for (const c of header) {
    const match = c.match(new RegExp(`^${name}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

export async function loginAsUser(): Promise<string> {
  // NoSQL injection — bypass auth without knowing the password
  const res = await post('/login', {
    email:    { $gt: '' },
    password: { $gt: '' },
  });
  const cookie = extractCookie(res, 'session');
  if (!cookie) throw new Error('NoSQL injection login failed — no session cookie');
  return cookie;
}

export async function getWithSession(path: string, sessionCookie: string): Promise<Response> {
  return get(path, { headers: { Cookie: `session=${sessionCookie}` } });
}

export async function postWithSession(
  path: string, body: unknown, sessionCookie: string
): Promise<Response> {
  return post(path, body, { headers: { Cookie: `session=${sessionCookie}` } });
}

export async function getWithAdminSession(path: string, adminToken: string): Promise<Response> {
  return get(path, { headers: { Cookie: `admin_session=${adminToken}` } });
}

export async function postWithAdminSession(
  path: string, body: unknown, adminToken: string
): Promise<Response> {
  return post(path, body, { headers: { Cookie: `admin_session=${adminToken}` } });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
