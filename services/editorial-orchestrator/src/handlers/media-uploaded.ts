import crypto from 'node:crypto';
import { EventEnvelope } from '@2mbi/contracts';
import redis from '../redis.js';
import { parseEnv } from '../env.js';

function buildEnvelope(
  event: EventEnvelope,
  messageType: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    schemaVersion: 1,
    messageId: crypto.randomUUID(),
    messageType: messageType as EventEnvelope['messageType'],
    correlationId: event.correlationId,
    causationId: event.messageId,
    idempotencyKey: crypto.randomUUID(),
    tenantId: event.tenantId,
    productId: event.productId,
    occurredAt: new Date().toISOString(),
    data,
  };
}

async function publishCommand(
  stream: string,
  envelope: EventEnvelope,
): Promise<void> {
  await redis.xadd(stream, '*', 'payload', JSON.stringify(envelope));
}

export async function handleMediaUploaded(event: EventEnvelope): Promise<void> {
  const env = parseEnv();
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const tenantId = String(data.tenantId || event.tenantId);
  const productId = String(data.productId || event.productId);
  const sourceKey = String(data.sourceKey || '');

  if (!mediaId || !jobId || !tenantId) {
    throw new Error('Missing required fields in MediaUploaded event data');
  }

  const command = buildEnvelope(event, 'IngestionRequested', {
    jobId,
    mediaId,
    tenantId,
    productId,
    sourceKey,
  });

  await publishCommand(env.REDIS_MEDIA_TASKS_STREAM, command);
  console.log(`Dispatched IngestionRequested for media=${mediaId} job=${jobId}`);
}

export async function handleMediaIngestionCompleted(event: EventEnvelope): Promise<void> {
  const env = parseEnv();
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const tenantId = event.tenantId;
  const productId = event.productId;
  const audioKey = String(data.audioKey || '');

  if (!mediaId || !jobId || !audioKey) {
    throw new Error('Missing required fields in MediaIngestionCompleted');
  }

  const command = buildEnvelope(event, 'TranscriptionRequested', {
    jobId,
    mediaId,
    tenantId,
    productId,
    audioKey,
  });

  await publishCommand(env.REDIS_MEDIA_TASKS_STREAM, command);
  console.log(`Dispatched TranscriptionRequested for media=${mediaId}`);
}

export async function handleTranscriptionCompleted(event: EventEnvelope): Promise<void> {
  const env = parseEnv();
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const tenantId = event.tenantId;
  const productId = event.productId;
  const transcriptId = String(data.transcriptId || '');

  if (!mediaId || !jobId || !transcriptId) {
    throw new Error('Missing required fields in TranscriptionCompleted');
  }

  const command = buildEnvelope(event, 'EditorialAnalysisRequested', {
    jobId,
    mediaId,
    tenantId,
    productId,
    transcriptId,
  });

  await publishCommand(env.REDIS_EDITORIAL_TASKS_STREAM, command);
  console.log(`Dispatched EditorialAnalysisRequested for media=${mediaId}`);
}

export async function handleMediaContentPlanGenerated(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  console.log(`Editorial plan generated for media=${mediaId}, awaiting user review`);
}

export async function handleMediaContentPlanApproved(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');

  console.log(`Plan approved for media=${mediaId}, generating clips...`);
}

export async function handleRenderCompleted(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const clipId = String(data.clipId || '');
  console.log(`Render completed for media=${mediaId} clip=${clipId}`);
}

export async function handlePublishingCompleted(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  console.log(`Publishing completed for media=${mediaId}`);
}
