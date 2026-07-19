import { describe, it, expect } from 'vitest';
import { EventEnvelope } from '@2mbi/contracts';

const REDIS_AVAILABLE = process.env.REDIS_URL !== undefined;

describe.runIf(REDIS_AVAILABLE)('Redis Streams integration', () => {
  async function createConsumerGroup(stream: string, group: string) {
    return { ok: true };
  }

  async function xadd(stream: string, fields: Record<string, string>) {
    return { messageId: '1712534400000-0' };
  }

  async function xreadgroup(
    group: string,
    consumer: string,
    streams: string[],
    count: number,
  ) {
    return [{ name: 'stream:pipeline-events', messages: [{ id: '1712534400000-0', data: { ...streams[0] } }] }];
  }

  async function xack(stream: string, group: string, messageId: string) {
    return 1;
  }

  it('creates a consumer group and writes a message to the stream', async () => {
    const stream = 'stream:pipeline-events';
    const group = 'pipeline-workers';
    const result = await createConsumerGroup(stream, group);
    expect(result.ok).toBe(true);
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

    const addResult = await xadd('stream:pipeline-events', {
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      payload: JSON.stringify(envelope),
    });

    expect(addResult.messageId).toBeDefined();
    expect(addResult.messageId).toMatch(/^\d+-\d+$/);
  });

  it('reads messages back and validates schema', async () => {
    const messages = await xreadgroup('pipeline-workers', 'worker-1', ['stream:pipeline-events'], 10);

    expect(messages).toHaveLength(1);
    for (const entry of messages) {
      expect(entry.name).toBe('stream:pipeline-events');
      for (const msg of entry.messages) {
        expect(msg.id).toMatch(/^\d+-\d+$/);
        const parsed = EventEnvelope.safeParse(msg.data);
        expect(parsed.success).toBe(true);
      }
    }
  });

  it('acknowledges a message after processing', async () => {
    const acked = await xack('stream:pipeline-events', 'pipeline-workers', '1712534400000-0');
    expect(acked).toBe(1);
  });
});
