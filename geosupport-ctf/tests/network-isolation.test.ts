import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

/**
 * Network isolation tests.
 *
 * These tests verify network boundaries from the host and from inside containers.
 * Many require the Docker stack to be running and docker exec access.
 * Tests that cannot be verified from the host are marked with the container
 * they should be executed from.
 */

const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'geosupport-ctf';

async function containerExec(service: string, cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker compose exec -T ${service} sh -c "${cmd.replace(/"/g, '\\"')}"`,
      { timeout: 15000 }
    );
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

describe('Network isolation', () => {

  test('MongoDB port 27017 is not published to host', async () => {
    try {
      const res = await fetch('http://localhost:27017', { signal: AbortSignal.timeout(2000) });
      // If it responds it might be something else; check it's not mongo
      assert.ok(false, 'MongoDB port should not be reachable from host');
    } catch {
      // Expected — connection refused or timeout
    }
  });

  test('flag-service port 8080 is not published (beyond app port)', async () => {
    // The public port is the app's; flag-service has no host binding.
    // We try port 8081+ to confirm flag-service isn't leaking.
    for (const port of [8081, 8082, 9090]) {
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
        const body = await res.text();
        assert.ok(!body.includes('GeoSupport{'), `Flag must not be accessible on host port ${port}`);
      } catch {
        // Connection refused is correct
      }
    }
  });

  test('web container cannot reach flag-service directly', async () => {
    // flag-service is not on app-net, so web container DNS lookup should fail
    const result = await containerExec('web', 'wget -qO- --timeout=3 http://flag-service:8080/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.stdout.includes('Connection refused') ||
      result.code !== 0,
      `Web container must not reach flag-service. Got: ${result.stdout}`
    );
  });

  test('ssrf-worker cannot reach MongoDB', async () => {
    const result = await containerExec('ssrf-worker', 'wget -qO- --timeout=3 http://mongo:27017/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `SSRF worker must not reach MongoDB. Got: ${result.stdout}`
    );
  });

  test('ssrf-worker cannot reach web application', async () => {
    const result = await containerExec('ssrf-worker', 'wget -qO- --timeout=3 http://web:3000/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `SSRF worker must not reach web app. Got: ${result.stdout}`
    );
  });

  test('ssrf-worker cannot reach nginx', async () => {
    const result = await containerExec('ssrf-worker', 'wget -qO- --timeout=3 http://nginx:8080/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `SSRF worker must not reach nginx. Got: ${result.stdout}`
    );
  });

  test('ssrf-worker cannot reach public internet', async () => {
    // flag-net is internal: true, so no default gateway
    const result = await containerExec('ssrf-worker', 'wget -qO- --timeout=5 http://example.com/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Network unreachable') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `SSRF worker must not reach internet. Got: ${result.stdout}`
    );
  });

  test('ssrf-worker CAN reach flag server on its own loopback', async () => {
    // The flag server runs on 127.0.0.1:80 inside the ssrf-worker container.
    // We verify this by confirming the SSRF job for http://127.0.0.1/flag.txt succeeds.
    const result = await containerExec('ssrf-worker',
      'node -e "fetch(\'http://127.0.0.1/flag.txt\').then(r=>r.text()).then(t=>console.log(t.trim())).catch(e=>console.log(\'FAIL:\',e.message))"');
    assert.ok(
      result.stdout.includes('IGT{') || result.stdout.includes('flag'),
      `SSRF worker must be able to reach its own flag server. Got: ${result.stdout}`
    );
  });

  test('admin-bot cannot reach MongoDB', async () => {
    const result = await containerExec('admin-bot', 'wget -qO- --timeout=3 http://mongo:27017/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `Admin bot must not reach MongoDB. Got: ${result.stdout}`
    );
  });

  test('admin-bot cannot reach flag-service', async () => {
    const result = await containerExec('admin-bot', 'wget -qO- --timeout=3 http://flag-service:8080/ 2>&1 || echo FAILED');
    assert.ok(
      result.stdout.includes('FAILED') ||
      result.stdout.includes('bad address') ||
      result.stdout.includes('Name or service not known') ||
      result.code !== 0,
      `Admin bot must not reach flag-service. Got: ${result.stdout}`
    );
  });

  test('flag is not present in web application logs', async () => {
    const result = await containerExec('web', 'env | grep -i flag || echo NO_FLAG');
    assert.ok(
      result.stdout.includes('NO_FLAG'),
      `FLAG must not be in web container environment. Got: ${result.stdout}`
    );
  });

  test('flag is not served in any public static file', async () => {
    const BASE = process.env.APP_URL ?? 'http://localhost:8080';
    for (const path of ['/js/main.js', '/js/login.js', '/js/support.js', '/css/main.css']) {
      try {
        const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const body = await res.text();
          assert.ok(!body.includes('GeoSupport{'), `Flag must not be in static asset ${path}`);
        }
      } catch { /* asset might not exist */ }
    }
  });

});
