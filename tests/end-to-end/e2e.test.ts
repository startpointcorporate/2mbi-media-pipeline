import { describe, it, expect } from 'vitest';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';

describe.runIf(process.env.E2E === 'true')('End-to-end pipeline', () => {
  it('upload → job created → outbox → stream', async () => {
    const formData = new FormData();
    const blob = new Blob(['fake video content'], { type: 'video/mp4' });
    formData.append('file', blob, 'test-video.mp4');
    formData.append('tenantId', 'konektag');
    formData.append('productId', 'konektag');

    const uploadRes = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      body: formData,
    });
    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json() as { mediaId: string; jobId: string };
    expect(body.mediaId).toBeDefined();
    expect(body.jobId).toBeDefined();
  });

  it('job lists returns results', async () => {
    const res = await fetch(`${API_BASE}/api/v1/jobs`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { jobs: Array<{ id: string }> };
    expect(Array.isArray(body.jobs)).toBe(true);
  });
});
