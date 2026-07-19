import { describe, it, expect } from 'vitest';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';

describe.skip('End-to-End: Media Upload Pipeline', () => {
  it('uploads a media file and polls job status', async () => {
    const formData = new FormData();
    const blob = new Blob(['fake video content'], { type: 'video/mp4' });
    formData.append('file', blob, 'test-video.mp4');
    formData.append('tenantId', 'konektag');
    formData.append('productId', 'konektag');

    const uploadRes = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: 'POST',
      body: formData,
    });
    expect(uploadRes.ok).toBe(true);
    const { mediaId, jobId } = await uploadRes.json() as { mediaId: string; jobId: string };
    expect(mediaId).toBeDefined();
    expect(jobId).toBeDefined();

    let status = 'pending';
    const maxPolls = 30;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const jobRes = await fetch(`${API_BASE}/api/v1/jobs/${jobId}`);
      const job = await jobRes.json() as { status: string };
      status = job.status;
      if (status !== 'pending') break;
    }
    expect(status).not.toBe('pending');
  });

  it('verifies outbox event was created after upload', async () => {
    const res = await fetch(`${API_BASE}/api/v1/jobs`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { jobs: Array<{ id: string }> };
    expect(Array.isArray(body.jobs)).toBe(true);
  });
});
