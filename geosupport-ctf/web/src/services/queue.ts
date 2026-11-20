/**
 * File-based job queue shared between the web application and the SSRF worker
 * via a Docker-managed volume.
 *
 * The web app writes job files; the SSRF worker reads and processes them.
 * Result files flow back through the same volume.
 *
 * File layout:
 *   QUEUE_PATH/jobs/<jobId>.json      — written by the web app
 *   QUEUE_PATH/results/<jobId>.json   — written by the SSRF worker
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_PATH = process.env.QUEUE_PATH ?? '/var/queue';
const JOBS_DIR   = path.join(QUEUE_PATH, 'jobs');
const RESULTS_DIR = path.join(QUEUE_PATH, 'results');

export interface SSRFJob {
  jobId: string;
  url: string;
  submittedAt: string;
  requestedBy: string; // 'admin' — only admin can enqueue
}

export interface SSRFResult {
  jobId: string;
  status: 'ok' | 'error';
  statusCode?: number;
  body?: string;
  error?: string;
  completedAt: string;
}

export function ensureQueueDirs(): void {
  fs.mkdirSync(JOBS_DIR,    { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

export function enqueueJob(url: string): string {
  ensureQueueDirs();
  const jobId = uuidv4();
  const job: SSRFJob = { jobId, url, submittedAt: new Date().toISOString(), requestedBy: 'admin' };
  fs.writeFileSync(path.join(JOBS_DIR, `${jobId}.json`), JSON.stringify(job));
  return jobId;
}

export async function pollResult(jobId: string, timeoutMs = 15000): Promise<SSRFResult> {
  const resultFile = path.join(RESULTS_DIR, `${jobId}.json`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (fs.existsSync(resultFile)) {
      const raw = fs.readFileSync(resultFile, 'utf8');
      return JSON.parse(raw) as SSRFResult;
    }
    await sleep(300);
  }
  throw new Error('SSRF job timed out');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
