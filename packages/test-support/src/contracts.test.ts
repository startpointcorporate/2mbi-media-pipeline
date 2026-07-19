import { describe, it, expect } from 'vitest';
import { EventEnvelope, WorkerResultPayload, HeartbeatPayload } from '@2mbi/contracts';
import { z } from 'zod';

const uuid = () => '550e8400-e29b-41d4-a716-446655440000';

describe('EventEnvelope', () => {
  it('validates with correct data', () => {
    const data = {
      schemaVersion: 1 as const,
      messageId: uuid(),
      messageType: 'MediaUploaded' as const,
      correlationId: uuid(),
      causationId: uuid(),
      idempotencyKey: uuid(),
      occurredAt: '2024-01-01T00:00:00.000Z',
      tenantId: 'konektag',
      productId: 'konektag',
      data: { mediaId: uuid(), jobId: uuid() },
    };
    expect(EventEnvelope.parse(data)).toEqual(data);
  });

  it('fails when required field is missing', () => {
    const data = {
      schemaVersion: 1 as const,
      messageId: uuid(),
      correlationId: uuid(),
      causationId: uuid(),
      idempotencyKey: uuid(),
      occurredAt: '2024-01-01T00:00:00.000Z',
      tenantId: 'konektag',
      productId: 'konektag',
      data: {},
    };
    expect(() => EventEnvelope.parse(data)).toThrow();
  });

  it('fails with invalid uuid', () => {
    const data = {
      schemaVersion: 1 as const,
      messageId: 'not-a-uuid',
      messageType: 'MediaUploaded' as const,
      correlationId: uuid(),
      causationId: uuid(),
      idempotencyKey: uuid(),
      occurredAt: '2024-01-01T00:00:00.000Z',
      tenantId: 'konektag',
      productId: 'konektag',
      data: {},
    };
    expect(() => EventEnvelope.parse(data)).toThrow();
  });
});

describe('WorkerResultPayload', () => {
  it('validates with correct data', () => {
    const data = {
      jobId: uuid(),
      stepId: uuid(),
      idempotencyKey: uuid(),
      resultType: 'MediaIngestionCompleted',
      result: { normalizedKey: 'foo.mp4', durationSeconds: 120 },
    };
    expect(WorkerResultPayload.parse(data)).toEqual(data);
  });

  it('fails when jobId is missing', () => {
    const data = {
      stepId: uuid(),
      idempotencyKey: uuid(),
      resultType: 'MediaIngestionCompleted',
      result: {},
    };
    expect(() => WorkerResultPayload.parse(data)).toThrow();
  });
});

describe('Retry schedule schema', () => {
  const RetryScheduleStep = z.object({
    step: z.number().int().positive(),
    delayMs: z.number().int().positive(),
  });

  const RetrySchedule = z.object({
    scheduleId: z.string().uuid(),
    commandType: z.string(),
    scheduledAt: z.string().datetime(),
    steps: z.array(RetryScheduleStep),
  });

  it('validates a retry schedule with multiple steps', () => {
    const data = {
      scheduleId: '550e8400-e29b-41d4-a716-446655440001',
      commandType: 'IngestionRequested',
      scheduledAt: '2024-01-01T00:00:00.000Z',
      steps: [
        { step: 1, delayMs: 5_000 },
        { step: 2, delayMs: 15_000 },
        { step: 3, delayMs: 60_000 },
      ],
    };
    expect(RetrySchedule.parse(data)).toEqual(data);
  });

  it('rejects a retry schedule with zero delay', () => {
    expect(() =>
      RetrySchedule.parse({
        scheduleId: '550e8400-e29b-41d4-a716-446655440002',
        commandType: 'IngestionRequested',
        scheduledAt: '2024-01-01T00:00:00.000Z',
        steps: [{ step: 1, delayMs: 0 }],
      }),
    ).toThrow();
  });
});

describe('DLQ message format', () => {
  const DeadLetterMessage = z.object({
    originalCommand: z.object({
      messageType: z.string(),
      messageId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      data: z.record(z.unknown()),
    }),
    error: z.string().min(1),
    failedAt: z.string().datetime(),
    failedAttempts: z.number().int().positive(),
  });

  it('validates a DLQ message with full context', () => {
    const data = {
      originalCommand: {
        messageType: 'IngestionRequested',
        messageId: '550e8400-e29b-41d4-a716-446655440010',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440011',
        data: { jobId: '550e8400-e29b-41d4-a716-446655440012', mediaId: '550e8400-e29b-41d4-a716-446655440013' },
      },
      error: 'Worker timed out after 30s',
      failedAt: '2024-01-01T00:05:00.000Z',
      failedAttempts: 3,
    };
    expect(DeadLetterMessage.parse(data)).toEqual(data);
  });

  it('rejects DLQ message with empty error', () => {
    expect(() =>
      DeadLetterMessage.parse({
        originalCommand: {
          messageType: 'IngestionRequested',
          messageId: '550e8400-e29b-41d4-a716-446655440020',
          idempotencyKey: '550e8400-e29b-41d4-a716-446655440021',
          data: {},
        },
        error: '',
        failedAt: '2024-01-01T00:05:00.000Z',
        failedAttempts: 1,
      }),
    ).toThrow();
  });
});

describe('Backoff calculation', () => {
  function exponentialBackoff(attempt: number, baseMs: number, maxMs: number): number {
    const delay = baseMs * 2 ** (attempt - 1);
    return Math.min(delay, maxMs);
  }

  it('returns base delay for first attempt', () => {
    expect(exponentialBackoff(1, 1000, 30000)).toBe(1000);
  });

  it('doubles on each attempt', () => {
    expect(exponentialBackoff(2, 1000, 30000)).toBe(2000);
    expect(exponentialBackoff(3, 1000, 30000)).toBe(4000);
    expect(exponentialBackoff(4, 1000, 30000)).toBe(8000);
  });

  it('caps at max delay', () => {
    expect(exponentialBackoff(10, 1000, 30000)).toBe(30000);
    expect(exponentialBackoff(20, 1000, 30000)).toBe(30000);
  });

  it('works with non-standard base', () => {
    expect(exponentialBackoff(1, 5000, 120000)).toBe(5000);
    expect(exponentialBackoff(2, 5000, 120000)).toBe(10000);
    expect(exponentialBackoff(5, 5000, 120000)).toBe(80000);
  });
});

describe('HeartbeatPayload', () => {
  it('validates with correct data', () => {
    const data = {
      workerId: 'worker-1',
      progress: 50,
      leaseDurationSeconds: 300,
    };
    expect(HeartbeatPayload.parse(data)).toEqual(data);
  });

  it('fails with negative progress', () => {
    const data = {
      workerId: 'worker-1',
      progress: -1,
      leaseDurationSeconds: 300,
    };
    expect(() => HeartbeatPayload.parse(data)).toThrow();
  });

  it('fails with progress over 100', () => {
    const data = {
      workerId: 'worker-1',
      progress: 101,
      leaseDurationSeconds: 300,
    };
    expect(() => HeartbeatPayload.parse(data)).toThrow();
  });

  it('fails with empty workerId', () => {
    const data = {
      workerId: '',
      progress: 50,
      leaseDurationSeconds: 300,
    };
    expect(() => HeartbeatPayload.parse(data)).toThrow();
  });
});
