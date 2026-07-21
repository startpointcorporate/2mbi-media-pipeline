import crypto from 'node:crypto';
import { EventEnvelope } from '@2mbi/contracts';
import redis from '../redis.js';
import { parseEnv } from '../env.js';
import { query } from '../db.js';

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
  const payload = {
    ...envelope,
    step: envelope.messageType,
  };
  await redis.xadd(stream, '*', 'payload', JSON.stringify(payload));
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

  await query(
    `UPDATE media_pipeline.media_jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );

  const command = buildEnvelope(event, 'TranscriptionRequested', {
    jobId,
    mediaId,
    tenantId,
    productId,
    audioKey,
  });

  await publishCommand(env.REDIS_MEDIA_TASKS_STREAM, command);
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
}

export async function handleMediaContentPlanGenerated(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const planId = String(data.planId || '');

  await query(
    `UPDATE media_pipeline.media_jobs SET status = 'awaiting_review', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );

  console.log(`[orchestrator] Plan generated for media=${mediaId} plan=${planId} — awaiting user review`);
}

export async function handleMediaContentPlanApproved(event: EventEnvelope): Promise<void> {
  const env = parseEnv();
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const approvedClipIds = (data.approvedClipIds as string[]) || [];

  if (!mediaId || !jobId || approvedClipIds.length === 0) {
    console.log(`[orchestrator] Plan approved but no clips selected for media=${mediaId}`);
    return;
  }

  const clipsResult = await query(
    `SELECT c.id, c.start_time, c.end_time, c.source_key, c.title,
            cp.platforms, cp.description, cp.hashtags
     FROM media_pipeline.clips c
     LEFT JOIN media_pipeline.clip_proposals cp ON cp.id = c.proposal_id
     WHERE c.id = ANY($1::uuid[]) AND c.media_id = $2`,
    [approvedClipIds, mediaId],
  );

  if (clipsResult.rowCount === 0) {
    console.log(`[orchestrator] No clips found for approved IDs in media=${mediaId}`);
    return;
  }

  await query(
    `UPDATE media_pipeline.media_jobs SET status = 'rendering', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );

  for (const clip of clipsResult.rows) {
    const clipId = clip.id as string;
    const sourceKey = clip.source_key as string;

    const command = buildEnvelope(event, 'RenderVideoRequested', {
      jobId,
      mediaId,
      tenantId: event.tenantId,
      productId: event.productId,
      clipId,
      sourceKey,
      renderProfile: {
        name: 'landscape',
        format: '16:9',
        width: 1920,
        height: 1080,
        strategy: 'contain',
        faststart: true,
      },
      outputPrefix: `renders/${event.tenantId}/${mediaId}/${clipId}`,
    });

    await publishCommand(env.REDIS_MEDIA_TASKS_STREAM, command);
    console.log(`[orchestrator] Dispatched render for clip=${clipId} media=${mediaId}`);
  }
}

export async function handleRenderCompleted(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');
  const clipId = String(data.clipId || '');

  const renders = await query(
    `SELECT COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE ca.id IS NOT NULL)::int as rendered
     FROM media_pipeline.clips c
     LEFT JOIN media_pipeline.clip_assets ca ON ca.clip_id = c.id
     WHERE c.media_id = $1 AND c.status = 'generated'`,
    [mediaId],
  );

  if (renders.rows[0]) {
    const { total, rendered } = renders.rows[0] as { total: number; rendered: number };

    if (rendered > 0 && rendered >= total) {
      await query(
        `UPDATE media_pipeline.media_jobs SET status = 'rendered', updated_at = NOW() WHERE id = $1`,
        [jobId],
      );
      console.log(`[orchestrator] All ${total} clips rendered for media=${mediaId}`);
    }
  }

  console.log(`[orchestrator] Render completed for media=${mediaId} clip=${clipId}`);
}

export async function handlePublishingCompleted(event: EventEnvelope): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const mediaId = String(data.mediaId || '');
  const jobId = String(data.jobId || '');

  await query(
    `UPDATE media_pipeline.media_jobs SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );

  await query(
    `UPDATE media_pipeline.media_assets SET status = 'ready', updated_at = NOW() WHERE id = $1`,
    [mediaId],
  );

  console.log(`[orchestrator] Publishing completed for media=${mediaId} — job marked COMPLETED`);
}
