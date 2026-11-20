/**
 * GeoSupport SSRF Worker
 *
 * Two responsibilities:
 *
 * 1. Internal flag server — binds to 127.0.0.1:80 inside this container and
 *    serves the flag at GET /flag.txt.  From the SSRF worker's own perspective,
 *    http://127.0.0.1/flag.txt returns the flag.  No other container shares
 *    this loopback, so the flag is only reachable via SSRF through this worker.
 *
 * 2. Job queue processor — reads job files from the shared volume, makes the
 *    HTTP request (which may target 127.0.0.1), and writes results back.
 *
 * Network isolation:
 *  - This container is on the `flag-net` network only (internal: true).
 *  - It cannot reach MongoDB, the web application, Nginx, or the admin bot.
 *  - It cannot reach the public internet.
 *  - The flag server binds only to 127.0.0.1 — not reachable by any other
 *    container, only by fetch() calls that originate inside this process.
 *
 * Protocol restrictions:
 *  - Only HTTP and HTTPS are permitted.
 *  - Redirects are disabled.
 *  - Timeout: 10 seconds.
 *  - Response body limit: 128 KB.
 */

import fs   from 'fs';
import path from 'path';
import http from 'http';

const QUEUE_PATH  = process.env.QUEUE_PATH ?? '/var/queue';
const JOBS_DIR    = path.join(QUEUE_PATH, 'jobs');
const RESULTS_DIR = path.join(QUEUE_PATH, 'results');
const POLL_MS     = 500;
const TIMEOUT_MS  = 10_000;
const MAX_BYTES   = 128 * 1024; // 128 KB

// Flag is read from env (injected via Docker secret or .env at startup)
const FLAG = process.env.FLAG;
if (!FLAG) {
  console.error('[worker] FLAG environment variable is not set — aborting');
  process.exit(1);
}

// ── Internal flag server ─────────────────────────────────────────────────────
// Listens on 127.0.0.1:80 so the SSRF target is http://127.0.0.1/flag.txt —
// the most natural address a player would try when probing an SSRF.
function startFlagServer(): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/flag.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(FLAG + '\n');
      return;
    }
    // All other paths return 404 with no useful information
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found\n');
  });

  // Bind exclusively to loopback — not accessible from any other container
  server.listen(80, '127.0.0.1', () => {
    console.log('[worker] Flag server listening on 127.0.0.1:80');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EACCES') {
      // Port 80 requires root or CAP_NET_BIND_SERVICE.
      // Fall back to port 8000 and log the actual target.
      console.warn('[worker] Cannot bind port 80 (EACCES) — trying 8000');
      server.listen(8000, '127.0.0.1', () => {
        console.log('[worker] Flag server listening on 127.0.0.1:8000');
        console.log('[worker] SSRF target: http://127.0.0.1:8000/flag.txt');
      });
    } else {
      console.error('[worker] Flag server error:', err);
    }
  });
}

// ── Job queue processor ──────────────────────────────────────────────────────

interface SSRFJob {
  jobId: string;
  url: string;
  submittedAt: string;
  requestedBy: string;
}

interface SSRFResult {
  jobId: string;
  status: 'ok' | 'error';
  statusCode?: number;
  body?: string;
  error?: string;
  completedAt: string;
}

function ensureDirs(): void {
  fs.mkdirSync(JOBS_DIR,    { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

async function processJob(job: SSRFJob): Promise<void> {
  console.log(`[worker] Processing job ${job.jobId} → ${job.url}`);

  let result: SSRFResult;

  try {
    const parsed = new URL(job.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(job.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'GeoSupport-Validator/1.0',
          'Accept': '*/*',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // Read body with size limit
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated  = false;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_BYTES) {
            truncated = true;
            reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
    }

    const bodyBuf  = Buffer.concat(chunks.map(c => Buffer.from(c)));
    const bodyText = bodyBuf.toString('utf8') + (truncated ? '\n[... truncated]' : '');

    result = {
      jobId:       job.jobId,
      status:      'ok',
      statusCode:  response.status,
      body:        bodyText,
      completedAt: new Date().toISOString(),
    };

    console.log(`[worker] Job ${job.jobId} done — HTTP ${response.status}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${job.jobId} error: ${msg}`);
    result = {
      jobId:       job.jobId,
      status:      'error',
      error:       msg,
      completedAt: new Date().toISOString(),
    };
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, `${job.jobId}.json`),
    JSON.stringify(result)
  );
}

async function pollJobs(): Promise<void> {
  ensureDirs();
  const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const jobPath    = path.join(JOBS_DIR, file);
    const resultPath = path.join(RESULTS_DIR, file);

    if (fs.existsSync(resultPath)) {
      fs.unlinkSync(jobPath);
      continue;
    }

    let job: SSRFJob;
    try {
      job = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as SSRFJob;
    } catch {
      fs.unlinkSync(jobPath);
      continue;
    }

    const processingPath = jobPath + '.processing';
    fs.renameSync(jobPath, processingPath);

    await processJob(job);

    if (fs.existsSync(processingPath)) fs.unlinkSync(processingPath);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('[worker] SSRF worker started');
  console.log(`[worker] Queue path: ${QUEUE_PATH}`);

  // Start the internal flag server on loopback before processing any jobs
  startFlagServer();

  ensureDirs();

  while (true) {
    await pollJobs();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
