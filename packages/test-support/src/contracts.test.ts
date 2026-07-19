import { describe, it, expect } from 'vitest';
import { EventEnvelope, WorkerResultPayload, HeartbeatPayload } from '@2mbi/contracts';

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
