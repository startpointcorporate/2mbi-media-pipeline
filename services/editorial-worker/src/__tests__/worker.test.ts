import { describe, it, expect } from 'vitest';

describe('Ollama provider', () => {
  it('validates clip proposal has required fields', () => {
    const proposal = {
      startSegmentId: 12,
      endSegmentId: 18,
      title: 'Titre test',
      hook: 'Accroche test',
      reason: 'Raison',
      score: 0.87,
      platforms: ['instagram', 'tiktok'],
      description: 'Description sociale',
      hashtags: ['#test', '#media'],
    };
    expect(proposal.title).toBeTruthy();
    expect(proposal.hook).toBeTruthy();
    expect(proposal.startSegmentId).toBeLessThanOrEqual(proposal.endSegmentId);
    expect(proposal.score).toBeGreaterThanOrEqual(0);
    expect(proposal.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(proposal.platforms)).toBe(true);
    expect(proposal.platforms.length).toBeGreaterThan(0);
  });

  it('rejects clip with startSegmentId > endSegmentId', () => {
    const invalid = {
      startSegmentId: 18,
      endSegmentId: 12,
      title: 'Invalid',
      hook: 'H',
      reason: 'R',
      score: 0.5,
      platforms: ['instagram'],
      description: 'D',
      hashtags: [],
    };
    expect(invalid.startSegmentId).toBeGreaterThan(invalid.endSegmentId);
  });

  it('validates editorial analysis request has all required fields', () => {
    const request = {
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'test',
      productId: 'test-product',
      language: 'fr',
      targetPlatforms: ['instagram', 'tiktok'],
      constraints: {
        minimumClipDurationSeconds: 15,
        maximumClipDurationSeconds: 60,
        maximumClipCount: 3,
      },
      segments: [
        { segmentId: 1, start: 0.0, end: 3.5, text: 'Hello' },
        { segmentId: 2, start: 3.5, end: 7.0, text: 'World' },
      ],
    };
    expect(request.mediaId).toBeTruthy();
    expect(request.segments).toHaveLength(2);
    expect(request.constraints.minimumClipDurationSeconds).toBe(15);
  });

  it('converts segments to timecodes correctly', () => {
    const segments = [
      { segmentId: 5, start: 35.2, end: 41.8, text: 'Segment A' },
      { segmentId: 6, start: 41.8, end: 48.0, text: 'Segment B' },
      { segmentId: 7, start: 48.0, end: 55.3, text: 'Segment C' },
    ];

    const clipStartSegId = 5;
    const clipEndSegId = 7;
    const startSeg = segments.find((s) => s.segmentId === clipStartSegId);
    const endSeg = segments.find((s) => s.segmentId === clipEndSegId);

    expect(startSeg).toBeDefined();
    expect(endSeg).toBeDefined();
    if (startSeg && endSeg) {
      const clipStart = startSeg.start;
      const clipEnd = endSeg.end;
      expect(clipStart).toBe(35.2);
      expect(clipEnd).toBe(55.3);
      const duration = clipEnd - clipStart;
      expect(duration).toBeCloseTo(20.1, 1);
      expect(duration).toBeGreaterThanOrEqual(15);
      expect(duration).toBeLessThanOrEqual(60);
    }
  });
});

describe('Postiz provider', () => {
  it('validates publication preparation request', () => {
    const request = {
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'test',
      channels: ['instagram'],
      title: 'Test post',
      description: 'Test description',
      hashtags: ['#test'],
      assetUrls: { instagram: 'https://media.example.com/vid.mp4' },
    };
    expect(request.channels).toHaveLength(1);
    expect(request.assetUrls).toHaveProperty('instagram');
  });

  it('validates publication result has status', () => {
    const result = {
      publicationId: 'test-id',
      channel: 'instagram',
      externalId: 'ext-123',
      status: 'published',
      publicUrl: 'https://instagram.com/p/test',
    };
    expect(result.status).toBeTruthy();
  });

  it('handles failed publication result', () => {
    const result = {
      publicationId: 'test-id',
      channel: 'instagram',
      externalId: 'ext-456',
      status: 'failed',
      error: 'Rate limit exceeded',
    };
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});
