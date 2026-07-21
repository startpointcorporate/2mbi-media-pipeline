import { describe, it, expect } from 'vitest';
import {
  TranscriptionSegment,
  TranscriptionData,
  EditorialClipProposal,
  EditorialAnalysisResult,
  RenderProfile,
  BrandProfile,
  PublicationStatus,
  MediaDeliveryProviderConfig,
  RetryEntry,
  DeadLetterMessage,
  BusinessError,
} from '@2mbi/contracts';

describe('Transcription contracts', () => {
  it('validates a transcription segment', () => {
    const seg = TranscriptionSegment.parse({
      segmentId: 1,
      start: 0.0,
      end: 4.2,
      text: 'Bonjour le monde',
    });
    expect(seg.segmentId).toBe(1);
    expect(seg.text).toBe('Bonjour le monde');
  });

  it('validates with optional speaker and confidence', () => {
    const seg = TranscriptionSegment.parse({
      segmentId: 5,
      start: 10.0,
      end: 14.5,
      text: 'Texte',
      speaker: 'SPEAKER_01',
      confidence: 0.95,
    });
    expect(seg.speaker).toBe('SPEAKER_01');
    expect(seg.confidence).toBe(0.95);
  });

  it('validates full transcription data', () => {
    const data = TranscriptionData.parse({
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
      language: 'fr',
      durationSeconds: 298.4,
      text: 'Transcription complète',
      segments: [
        { segmentId: 1, start: 0.0, end: 4.2, text: 'Segment 1' },
        { segmentId: 2, start: 4.2, end: 8.5, text: 'Segment 2' },
      ],
    });
    expect(data.segments).toHaveLength(2);
    expect(data.durationSeconds).toBe(298.4);
  });

  it('rejects invalid segment with end < start', () => {
    expect(() =>
      TranscriptionSegment.parse({
        segmentId: 1,
        start: 10.0,
        end: -5.0,
        text: 'Invalid',
      }),
    ).toThrow();
  });

  it('rejects negative segmentId', () => {
    expect(() =>
      TranscriptionSegment.parse({
        segmentId: -1,
        start: 0,
        end: 5,
        text: 'Test',
      }),
    ).toThrow();
  });
});

describe('Editorial contracts', () => {
  it('validates a clip proposal', () => {
    const clip = EditorialClipProposal.parse({
      startSegmentId: 12,
      endSegmentId: 18,
      title: 'Titre',
      hook: 'Accroche',
      reason: 'Intéressant',
      score: 0.87,
      platforms: ['instagram', 'tiktok'],
      description: 'Description',
      hashtags: ['#test'],
    });
    expect(clip.score).toBe(0.87);
    expect(clip.platforms).toContain('instagram');
  });

  it('rejects score > 1', () => {
    expect(() =>
      EditorialClipProposal.parse({
        startSegmentId: 1,
        endSegmentId: 5,
        title: 'T',
        hook: 'H',
        reason: 'R',
        score: 1.5,
        platforms: ['instagram'],
        description: 'D',
        hashtags: [],
      }),
    ).toThrow();
  });

  it('rejects score < 0', () => {
    expect(() =>
      EditorialClipProposal.parse({
        startSegmentId: 1,
        endSegmentId: 5,
        title: 'T',
        hook: 'H',
        reason: 'R',
        score: -0.1,
        platforms: ['instagram'],
        description: 'D',
        hashtags: [],
      }),
    ).toThrow();
  });

  it('validates editorial analysis result', () => {
    const result = EditorialAnalysisResult.parse({
      summary: 'Résumé',
      clips: [
        {
          startSegmentId: 12,
          endSegmentId: 18,
          title: 'Titre',
          hook: 'Accroche',
          reason: 'Raison',
          score: 0.87,
          platforms: ['instagram'],
          description: 'Description',
          hashtags: ['#test'],
        },
      ],
      keywords: ['test'],
    });
    expect(result.clips).toHaveLength(1);
    expect(result.keywords).toEqual(['test']);
  });
});

describe('Render contracts', () => {
  it('validates render profile', () => {
    const profile = RenderProfile.parse({
      name: 'landscape',
      format: '16:9',
      width: 1920,
      height: 1080,
      strategy: 'contain',
      codec: 'h264',
      audioCodec: 'aac',
      faststart: true,
    });
    expect(profile.faststart).toBe(true);
  });

  it('validates with blur-background strategy', () => {
    const profile = RenderProfile.parse({
      name: 'portrait',
      format: '9:16',
      width: 1080,
      height: 1920,
      strategy: 'blur-background',
    });
    expect(profile.strategy).toBe('blur-background');
  });
});

describe('Branding contracts', () => {
  it('validates a brand profile', () => {
    const profile = BrandProfile.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'clapscelebrity',
      name: 'Claps Brand',
      logo: {
        key: 'branding/logo.png',
        position: 'bottom-right',
      },
    });
    expect(profile.tenantId).toBe('clapscelebrity');
    expect(profile.logo?.position).toBe('bottom-right');
  });

  it('validates minimal brand profile', () => {
    const profile = BrandProfile.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'konektag',
      name: 'Minimal',
    });
    expect(profile.colors).toBeUndefined();
    expect(profile.name).toBe('Minimal');
  });
});

describe('Publication contracts', () => {
  it('validates publication status', () => {
    expect(PublicationStatus.parse('draft')).toBe('draft');
    expect(PublicationStatus.parse('published')).toBe('published');
    expect(PublicationStatus.parse('failed')).toBe('failed');
  });

  it('rejects invalid status', () => {
    expect(() => PublicationStatus.parse('invalid')).toThrow();
  });
});

describe('Delivery contracts', () => {
  it('validates delivery config', () => {
    const config = MediaDeliveryProviderConfig.parse({
      publicBaseUrl: 'https://media.2mbiweb.com',
      privateUrlTtlSeconds: 900,
    });
    expect(config.privateUrlTtlSeconds).toBe(900);
  });
});

describe('Retry contracts', () => {
  it('validates retry entry', () => {
    const entry = RetryEntry.parse({
      command: { step: 'IngestionRequested' },
      step: 'IngestionRequested',
      attempt: 1,
      scheduledAt: new Date().toISOString(),
    });
    expect(entry.attempt).toBe(1);
  });

  it('validates dead letter message', () => {
    const msg = DeadLetterMessage.parse({
      command: { step: 'TranscriptionRequested' },
      error: 'Max retries exceeded',
      timestamp: new Date().toISOString(),
    });
    expect(msg.error).toBe('Max retries exceeded');
  });

  it('rejects dead letter with empty error', () => {
    expect(() =>
      DeadLetterMessage.parse({
        command: {},
        error: '',
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe('Business error', () => {
  it('validates business error', () => {
    const err = BusinessError.parse({
      code: 'TRANSCRIPTION_FAILED',
      message: 'Whisper model not found',
      recoverable: true,
    });
    expect(err.code).toBe('TRANSCRIPTION_FAILED');
    expect(err.recoverable).toBe(true);
  });
});
