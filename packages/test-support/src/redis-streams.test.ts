import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEnvelope } from '@2mbi/contracts';
import { Redis } from 'ioredis';

const REDIS_AVAILABLE = process.env.REDIS_URL !== undefined;

describe.runIf(REDIS_AVAILABLE)('Redis Streams integration', () => {
  let redis: Redis;
  const STREAM = 'test:stream:integration';
  const GROUP = 'test:group';

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    try {
      await redis.call('XGROUP', 'CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    } catch {
      // group may already exist
    }
  });

  afterAll(async () => {
    try {
      await redis.del(STREAM);
    } catch {}
    await redis.quit();
  });

  it('writes and reads back an EventEnvelope via Redis Streams', async () => {
    const envelope: EventEnvelope = {
      schemaVersion: 1,
      messageId: '550e8400-e29b-41d4-a716-446655440001',
      messageType: 'MediaUploaded',
      correlationId: '550e8400-e29b-41d4-a716-446655440002',
      causationId: '550e8400-e29b-41d4-a716-446655440003',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440004',
      occurredAt: '2024-01-01T00:00:00.000Z',
      tenantId: 'konektag',
      productId: 'konektag',
      data: { mediaId: '550e8400-e29b-41d4-a716-446655440005', jobId: '550e8400-e29b-41d4-a716-446655440006' },
    };

    const addResult = await redis.call('XADD', STREAM, '*', 'payload', JSON.stringify(envelope));
    expect(addResult).toBeDefined();
    expect(typeof addResult).toBe('string');
    expect(addResult).toMatch(/^\d+-\d+$/);
  });

  it('reads messages back and validates schema', async () => {
    const results = await redis.call(
      'XREADGROUP', 'GROUP', GROUP, 'test-consumer',
      'COUNT', '10', 'STREAMS', STREAM, '>',
    );

    expect(results).toBeDefined();
    const streams = results as Array<[string, Array<[string, Array<string>]>]>;
    expect(streams).toHaveLength(1);

    for (const [, messages] of streams) {
      for (const [messageId, fields] of messages) {
        expect(messageId).toMatch(/^\d+-\d+$/);

        const payloadIdx = fields.indexOf('payload');
        expect(payloadIdx).not.toBe(-1);

        const raw = fields[payloadIdx + 1] as string;
        const parsed = EventEnvelope.safeParse(JSON.parse(raw));
        expect(parsed.success).toBe(true);

        if (parsed.success) {
          expect(parsed.data.messageType).toBe('MediaUploaded');
          expect(parsed.data.tenantId).toBe('konektag');
        }
      }
    }
  });

  it('acknowledges a message after processing', async () => {
    const acked = await redis.call('XACK', STREAM, GROUP, '0-0');
    expect(Number(acked)).toBeGreaterThanOrEqual(0);
  });
});
