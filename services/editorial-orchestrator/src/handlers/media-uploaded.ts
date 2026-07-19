import type { EventEnvelope } from '@2mbi/contracts';
import redis from '../redis.js';
import { parseEnv } from '../env.js';
import { scheduleRetry } from '../retry.js';

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

  const command: Record<string, unknown> = {
    schemaVersion: 1,
    idempotencyKey: crypto.randomUUID(),
    correlationId: event.correlationId,
    causationId: event.messageId,
    step: 'IngestionRequested',
    data: { jobId, mediaId, tenantId, productId },
    occurredAt: new Date().toISOString(),
  };

  try {
    await redis.xadd(env.STREAM_MEDIA, '*', 'payload', JSON.stringify(command));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to publish IngestionRequested, scheduling retry: ${message}`);
    await scheduleRetry('IngestionRequested', command, 0);
  }
}
