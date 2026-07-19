import type { EventEnvelope } from '@2mbi/contracts';
import redis from '../redis.js';
import { parseEnv } from '../env.js';

export async function handleMediaUploaded(event: EventEnvelope): Promise<void> {
  const env = parseEnv();
  const data = event.data as Record<string, string | undefined>;
  const mediaId = data['mediaId'];
  const jobId = data['jobId'];
  const tenantId = data['tenantId'];
  const productId = data['productId'];

  if (!mediaId || !jobId || !tenantId || !productId) {
    throw new Error('Missing required fields in MediaUploaded event data');
  }

  const command = {
    schemaVersion: 1 as const,
    idempotencyKey: crypto.randomUUID(),
    correlationId: event.correlationId,
    causationId: event.messageId,
    step: 'IngestionRequested',
    data: { jobId, mediaId, tenantId, productId },
    occurredAt: new Date().toISOString(),
  };

  await redis.xadd(env.STREAM_MEDIA, '*', 'payload', JSON.stringify(command));
}
