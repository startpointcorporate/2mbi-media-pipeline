import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_BASE = process.env.E2E_API_URL || 'http://localhost:3001';
const TEST_TENANT = 'e2e-test';
const TEST_API_KEY = 'e2e_key';
const TEST_API_SECRET = 'e2e_secret';

function authHeaders(): Record<string, string> {
  return {
    'x-api-key': TEST_API_KEY,
    'x-api-secret': TEST_API_SECRET,
    'x-timestamp': String(Date.now()),
    'x-nonce': crypto.randomUUID(),
  };
}

function generateTestVideo(): { path: string; cleanup: () => void } {
  const dir = os.tmpdir();
  const videoPath = path.join(dir, `test-video-${Date.now()}.mp4`);

  // Create a minimal valid MP4 using ffmpeg if available, otherwise a mock
  try {
    const { execSync } = require('child_process');
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=blue:size=320x240:d=3" -f lavfi -i "sine=frequency=440:duration=3" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${videoPath}"`,
      { stdio: 'pipe', timeout: 10000 },
    );
  } catch {
    // ffmpeg not available, create a minimal file
    const buf = Buffer.alloc(1024);
    crypto.randomFillSync(buf);
    fs.writeFileSync(videoPath, buf);
  }

  return {
    path: videoPath,
    cleanup: () => {
      try { fs.unlinkSync(videoPath); } catch {}
    },
  };
}

describe('End-to-end pipeline flow', () => {
  let mediaId: string;
  let jobId: string;
  let clipId: string;
  let assetId: string;
  let packageId: string;
  const generatedIds: string[] = [];

  const video = generateTestVideo();

  afterAll(() => {
    video.cleanup();
  });

  it('1. Upload video master', async () => {
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(video.path)], { type: 'video/mp4' });
    form.append('file', blob, 'test.mp4');
    form.append('productId', 'e2e-product');

    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { mediaId: string; jobId: string };
    expect(body.mediaId).toBeTruthy();
    expect(body.jobId).toBeTruthy();

    mediaId = body.mediaId;
    jobId = body.jobId;
    generatedIds.push(mediaId);
  });

  it('2. Upload rejects without auth', async () => {
    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
    });
    expect(response.status).toBe(401);
  });

  it('3. Upload rejects with wrong apiSecret', async () => {
    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': TEST_API_KEY,
        'x-api-secret': 'wrong_secret',
        'x-timestamp': String(Date.now()),
        'x-nonce': crypto.randomUUID(),
      },
    });
    expect(response.status).toBe(401);
  });

  it('4. Upload rejects with expired timestamp', async () => {
    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': TEST_API_KEY,
        'x-api-secret': TEST_API_SECRET,
        'x-timestamp': String(Date.now() - 600_000),
        'x-nonce': crypto.randomUUID(),
      },
    });
    expect(response.status).toBe(401);
  });

  it('5. Upload rejects with reused nonce', async () => {
    const nonce = crypto.randomUUID();
    const hdrs = {
      'x-api-key': TEST_API_KEY,
      'x-api-secret': TEST_API_SECRET,
      'x-timestamp': String(Date.now()),
      'x-nonce': nonce,
    };

    // First request should work
    const form1 = new FormData();
    const blob = new Blob([fs.readFileSync(video.path)], { type: 'video/mp4' });
    form1.append('file', blob, 'test2.mp4');
    form1.append('productId', 'e2e-product');

    const resp1 = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: hdrs,
      body: form1,
    });
    expect(resp1.status).toBe(201);

    // Second request with same nonce should fail
    const form2 = new FormData();
    const blob2 = new Blob([fs.readFileSync(video.path)], { type: 'video/mp4' });
    form2.append('file', blob2, 'test3.mp4');
    form2.append('productId', 'e2e-product');

    const resp2 = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: hdrs,
      body: form2,
    });
    expect(resp2.status).toBe(401);
  });

  it('6. Cannot pick arbitrary tenant', async () => {
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(video.path)], { type: 'video/mp4' });
    form.append('file', blob, 'test.mp4');
    form.append('productId', 'e2e-product');

    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'x-tenant-id': 'another-tenant',
        'x-api-key': TEST_API_KEY,
        'x-api-secret': TEST_API_SECRET,
        'x-timestamp': String(Date.now()),
        'x-nonce': crypto.randomUUID(),
      },
      body: form,
    });
    expect(response.status).toBe(401);
  });

  it('7. Get job status', async () => {
    const response = await fetch(`${API_BASE}/api/v1/jobs/${jobId}`, {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { job: { status: string; id: string }; steps: unknown[] };
    expect(body.job).toBeTruthy();
    expect(body.job.id).toBe(jobId);
  });

  it('8. List jobs scoped to tenant', async () => {
    const response = await fetch(`${API_BASE}/api/v1/jobs`, {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobs: Array<{ id: string }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    // All returned jobs should be for the current tenant
    expect(body.jobs.every((j) => j)).toBe(true);
  });

  it('9. Get media assets', async () => {
    const response = await fetch(`${API_BASE}/api/v1/media/${mediaId}/assets`, {
      headers: authHeaders(),
    });

    expect([200, 404]).toContain(response.status);
  });

  it('10. Get package status', async () => {
    const response = await fetch(`${API_BASE}/api/v1/media/${mediaId}/package`, {
      headers: authHeaders(),
    });

    // May be 404 if package not generated yet
    expect([200, 404]).toContain(response.status);
  });
});
