import crypto from 'node:crypto';
import http from 'node:http';
import Redis from 'ioredis';
import pg from 'pg';
import { parseEnv } from './env.js';
import { OllamaEditorialAiProvider } from './providers/ollama.js';
import type { EditorialAiProvider, EditorialAnalysisRequest } from './providers/ollama.js';
import { PostizPublishingProvider } from './providers/postiz.js';
import type { PublishingProvider } from './providers/postiz.js';

const env = parseEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const redis = new Redis(env.REDIS_URL, { lazyConnect: true });

const ollamaProvider: EditorialAiProvider = new OllamaEditorialAiProvider();
const postizProvider: PublishingProvider = new PostizPublishingProvider();

const internalHeaders = { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_KEY };

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', env.STREAM_TASKS, env.CONSUMER_GROUP, '$', 'MKSTREAM');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) return;
    throw err;
  }
}

async function postWorkerResult(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${env.MEDIA_API_URL}/internal/worker-results`, {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Worker result API returned ${response.status}: ${await response.text()}`);
  }
}

async function handleEditorialAnalysis(command: Record<string, unknown>): Promise<void> {
  const jobId = String(command.jobId || '');
  const mediaId = String(command.mediaId || '');
  const tenantId = String(command.tenantId || '');
  const productId = String(command.productId || '');
  const stepId = String(command.stepId || '');
  const idempotencyKey = String(command.idempotencyKey || '');

  if (!jobId || !mediaId || !tenantId) {
    throw new Error('Missing required fields for editorial analysis');
  }

  const transcriptId = String(command.transcriptId || '');
  if (!transcriptId) {
    throw new Error('Missing transcriptId for editorial analysis');
  }

  const transcriptKey = `transcripts/${tenantId}/${mediaId}/${transcriptId}.json`;
  let segments: Array<{ segmentId: number; start: number; end: number; text: string; speaker?: string }> = [];

  try {
    const transcriptRes = await fetch(
      `${env.MEDIA_API_URL}/internal/transcripts/raw?key=${encodeURIComponent(transcriptKey)}`,
    );
    if (transcriptRes.ok) {
      const transcript = (await transcriptRes.json()) as { segments?: Array<{ segmentId: number; start: number; end: number; text: string; speaker?: string }> };
      segments = transcript.segments || [];
    }
  } catch {
    throw new Error(`Failed to fetch transcript: ${transcriptKey}`);
  }

  if (segments.length === 0) {
    throw new Error('No segments found in transcript');
  }

  const request: EditorialAnalysisRequest = {
    mediaId,
    tenantId,
    productId,
    language: String(command.language || 'fr'),
    contentType: command.contentType ? String(command.contentType) : undefined,
    targetPlatforms: (Array.isArray(command.targetPlatforms) ? command.targetPlatforms : ['instagram', 'tiktok', 'youtube_shorts']).map(String),
    constraints: {
      minimumClipDurationSeconds: Number(command.minimumClipDurationSeconds) || 15,
      maximumClipDurationSeconds: Number(command.maximumClipDurationSeconds) || 60,
      maximumClipCount: Number(command.maximumClipCount) || 3,
    },
    segments,
  };

  let result;
  let attempt = 0;
  const maxAttempts = 2;
  let lastError: Error | null = null;

  while (attempt < maxAttempts) {
    try {
      result = await ollamaProvider.analyzeTranscript(request);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attempt++;
      if (attempt >= maxAttempts) throw lastError;
    }
  }

  if (!result) {
    throw lastError || new Error('Editorial analysis failed after all attempts');
  }

  const planId = crypto.randomUUID();
  const planKey = `editorial/${tenantId}/${mediaId}/${planId}.json`;
  const planJson = JSON.stringify({ ...result, planId, mediaId, tenantId, createdAt: new Date().toISOString() });

  const response = await fetch(`${env.MEDIA_API_URL}/internal/objects`, {
    method: 'PUT',
    headers: internalHeaders,
    body: JSON.stringify({
      key: planKey,
      data: Buffer.from(planJson).toString('base64'),
      contentType: 'application/json',
    }),
  });
  if (!response.ok) throw new Error(`Failed to store editorial plan: ${response.status}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO media_pipeline.editorial_plans (id, media_id, job_id, transcription_id, tenant_id, product_id, summary, raw_result_key, model_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
      [planId, mediaId, jobId, transcriptId, tenantId, productId, result.summary, planKey, env.OLLAMA_MODEL],
    );

    const now = new Date().toISOString();
    for (const clip of result.clips) {
      const startSeg = segments.find((s) => s.segmentId === clip.startSegmentId);
      const endSeg = segments.find((s) => s.segmentId === clip.endSegmentId);
      if (!startSeg || !endSeg) continue;

      const clipId = crypto.randomUUID();
      await client.query(
        `INSERT INTO media_pipeline.clip_proposals (id, plan_id, media_id, tenant_id, product_id, start_segment_id, end_segment_id, start_time, end_time, title, hook, reason, score, platforms, description, hashtags, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending', $17, $17)`,
        [clipId, planId, mediaId, tenantId, productId, clip.startSegmentId, clip.endSegmentId, startSeg.start, endSeg.end, clip.title, clip.hook, clip.reason, clip.score, JSON.stringify(clip.platforms), clip.description, JSON.stringify(clip.hashtags), now],
      );
    }

    await client.query('COMMIT');

    await postWorkerResult({
      jobId,
      stepId,
      resultType: 'MediaContentPlanGenerated',
      idempotencyKey,
      workerId: `editorial-worker-${require('node:os').hostname()}`,
      durationMs: 0,
      result: {
        mediaId,
        jobId,
        planId,
        planKey,
        clipCount: result.clips.length,
      },
    });

    console.log(`Editorial analysis complete: plan=${planId} clips=${result.clips.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function handlePublishRequest(command: Record<string, unknown>): Promise<void> {
  const jobId = String(command.jobId || '');
  const mediaId = String(command.mediaId || '');
  const tenantId = String(command.tenantId || '');
  const stepId = String(command.stepId || '');
  const idempotencyKey = String(command.idempotencyKey || '');
  const publicationId = String(command.publicationId || '');

  if (!jobId || !mediaId || !publicationId || !tenantId) {
    throw new Error('Missing required fields for publish');
  }

  const pubResult = await pool.query(
    `SELECT pp.id, pp.channel, pp.external_id, pp.status, pp.scheduled_at,
            mp.title, mp.description, mp.hashtags, ca.key as asset_key
     FROM media_pipeline.media_publications mp
     JOIN media_pipeline.postiz_publications pp ON pp.publication_id = mp.id
     LEFT JOIN media_pipeline.clip_assets ca ON ca.media_id = mp.media_id AND ca.is_public = true
     WHERE mp.id = $1`,
    [publicationId],
  );

  if (pubResult.rowCount === 0) {
    throw new Error(`Publication not found: ${publicationId}`);
  }

  const publication = pubResult.rows[0];
  const result = await postizProvider.publish({
    publicationId,
    externalPublicationIds: [{ channel: publication.channel, externalId: publication.external_id }],
  });

  await pool.query(
    `UPDATE media_pipeline.postiz_publications
     SET status = $1, public_url = $2, published_at = $3, updated_at = NOW()
     WHERE id = $4`,
    [result.status, result.publicUrl || null, result.publishedAt || new Date().toISOString(), publication.id],
  );

  await postWorkerResult({
    jobId,
    stepId,
    resultType: result.status === 'published' ? 'PublishingCompleted' : 'PublishingFailed',
    idempotencyKey,
    workerId: `editorial-worker-${require('node:os').hostname()}`,
    durationMs: 0,
    result: {
      mediaId,
      jobId,
      publicationId,
      channel: result.channel,
      externalId: result.externalId,
      publicUrl: result.publicUrl,
      error: result.error,
    },
  });

  console.log(`Publish result for ${publicationId}: ${result.status}`);
}

const handlers: Record<string, (command: Record<string, unknown>) => Promise<void>> = {
  'EditorialAnalysisRequested': handleEditorialAnalysis,
  'PublishRequested': handlePublishRequest,
};

async function startWorker(): Promise<void> {
  await redis.connect();
  console.log('Editorial worker connected to Redis');

  await ensureConsumerGroup();
  console.log(`Consumer group '${env.CONSUMER_GROUP}' ready on '${env.STREAM_TASKS}'`);

  const consumer = `editorial-worker-${require('node:os').hostname()}`;

  while (true) {
    try {
      const result = (await redis.xreadgroup(
        'GROUP', env.CONSUMER_GROUP, consumer,
        'COUNT', '5',
        'BLOCK', '5000',
        'STREAMS', env.STREAM_TASKS,
        '>',
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!result) continue;

      for (const [, messages] of result) {
        for (const [messageId, fields] of messages) {
          const data: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i];
            const value = fields[i + 1];
            if (key === 'payload' && value) {
              try {
                const parsed = JSON.parse(value);
                Object.assign(data, parsed);
              } catch { /* skip malformed */ }
            }
          }

          const messageType = data.messageType || '';
          const handler = handlers[messageType];

          if (!handler) {
            await redis.xack(env.STREAM_TASKS, env.CONSUMER_GROUP, messageId);
            continue;
          }

          try {
            await handler(data);
            await redis.xack(env.STREAM_TASKS, env.CONSUMER_GROUP, messageId);
          } catch (err) {
            console.error(`Handler failed for ${messageType} (${messageId}):`, err);
            await redis.xack(env.STREAM_TASKS, env.CONSUMER_GROUP, messageId);
          }
        }
      }
    } catch (err) {
      console.error('Worker loop error:', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function startHealthServer(): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'editorial-worker' }));
  });
  server.listen(env.WORKER_PORT, () => {
    console.log(`Health server listening on port ${env.WORKER_PORT}`);
  });
}

startHealthServer();

startWorker().catch((err) => {
  console.error('Editorial worker crashed:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await redis.quit();
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await redis.quit();
  await pool.end();
  process.exit(0);
});
