import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { query, getClient } from '../db.js';
import { presignedGetUrl } from '../minio.js';
import { parseEnv } from '../env.js';
import { uuid } from '../lib/crypto.js';

interface AppVariables {
  tenantId: string;
}

const router = new Hono<{ Variables: AppVariables }>();
const env = parseEnv();

router.use('/api/*', async (c: Context, next: Next) => {
  const tenantId = c.req.header('x-tenant-id');
  const apiKey = c.req.header('x-api-key');
  const apiSecret = c.req.header('x-api-secret');

  const { authenticateRequest } = await import('../auth.js');
  const resolvedTenant = authenticateRequest(tenantId, apiKey, apiSecret);
  if (!resolvedTenant) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  c.set('tenantId', resolvedTenant);
  await next();
});

router.get('/api/v1/transcripts/:mediaId', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const result = await query(
      `SELECT t.id, t.media_id, t.language, t.duration_seconds, t.full_text as summary,
              t.json_key, t.srt_key, t.vtt_key, t.segment_count, t.created_at
       FROM media_pipeline.transcriptions t
       WHERE t.media_id = $1
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [mediaId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'Transcription not found' }, 404);
    }

    const transcript = result.rows[0];

    const segmentsResult = await query(
      `SELECT segment_id, start_time, end_time, text, speaker, confidence
       FROM media_pipeline.transcription_segments
       WHERE transcription_id = $1
       ORDER BY segment_id`,
      [transcript.id],
    );

    return c.json({
      transcription: {
        id: transcript.id,
        mediaId: transcript.media_id,
        language: transcript.language,
        durationSeconds: transcript.duration_seconds,
        text: transcript.summary,
        segmentCount: transcript.segment_count,
        createdAt: transcript.created_at,
      },
      segments: segmentsResult.rows.map((s) => ({
        segmentId: s.segment_id,
        start: s.start_time,
        end: s.end_time,
        text: s.text,
        speaker: s.speaker,
        confidence: s.confidence,
      })),
    });
  } catch (err) {
    console.error('Get transcript failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/transcripts/:mediaId/download', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const format = (c.req.query('format') || 'json').toLowerCase();

    const result = await query(
      `SELECT json_key, srt_key, vtt_key FROM media_pipeline.transcriptions
       WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [mediaId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'Transcription not found' }, 404);
    }

    const row = result.rows[0];
    let key: string;
    let contentType: string;
    let filename: string;

    switch (format) {
      case 'srt':
        key = row.srt_key; contentType = 'text/plain'; filename = 'transcript.srt'; break;
      case 'vtt':
        key = row.vtt_key; contentType = 'text/plain'; filename = 'transcript.vtt'; break;
      default:
        key = row.json_key; contentType = 'application/json'; filename = 'transcript.json'; break;
    }

    const url = await presignedGetUrl(key, env.MEDIA_PRIVATE_URL_TTL_SECONDS);
    return c.json({ url, key, contentType, filename, expiresInSeconds: env.MEDIA_PRIVATE_URL_TTL_SECONDS });
  } catch (err) {
    console.error('Download transcript failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/media/:mediaId/clips', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');

    const proposals = await query(
      `SELECT cp.id, cp.plan_id, cp.start_segment_id, cp.end_segment_id,
              cp.start_time, cp.end_time, cp.title, cp.hook, cp.reason,
              cp.score, cp.platforms, cp.description, cp.hashtags,
              cp.status, cp.created_at, cp.updated_at
       FROM media_pipeline.clip_proposals cp
       WHERE cp.media_id = $1
       ORDER BY cp.score DESC`,
      [mediaId],
    );

    const clips = await query(
      `SELECT cl.id, cl.proposal_id, cl.start_time, cl.end_time, cl.duration_seconds,
              cl.source_key, cl.title, cl.status, cl.checksum, cl.file_size, cl.created_at
       FROM media_pipeline.clips cl
       WHERE cl.media_id = $1
       ORDER BY cl.created_at DESC`,
      [mediaId],
    );

    return c.json({ proposals: proposals.rows, clips: clips.rows });
  } catch (err) {
    console.error('Get clips failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

const updateClipSchema = z.object({
  action: z.enum(['accept', 'reject', 'modify']),
  title: z.string().optional(),
  hook: z.string().optional(),
  description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  startTime: z.number().positive().optional(),
  endTime: z.number().positive().optional(),
});

router.patch('/api/v1/media/:mediaId/clips/:clipId', async (c) => {
  try {
    const clipId = c.req.param('clipId');
    const body = await c.req.json();
    const validation = updateClipSchema.safeParse(body);
    if (!validation.success) {
      return c.json({ error: 'Invalid input', details: validation.error.flatten() }, 400);
    }

    const { action, title, hook, description, hashtags, startTime, endTime } = validation.data;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      if (action === 'accept') {
        const proposal = await client.query(
          `SELECT id, media_id, job_id, tenant_id, product_id,
                  start_time, end_time, start_segment_id, end_segment_id, title
           FROM media_pipeline.clip_proposals WHERE id = $1`,
          [clipId],
        );
        if (proposal.rowCount === 0) {
          await client.query('ROLLBACK');
          client.release();
          return c.json({ error: 'Clip proposal not found' }, 404);
        }

        const p = proposal.rows[0];
        const clipId_new = uuid();
        const clipDuration = (p.end_time as number) - (p.start_time as number);
        const filename = `clip_${clipId_new}.mp4`;
        const sourceKey = `clips/${p.tenant_id}/${p.media_id}/${clipId_new}/${filename}`;

        await client.query(
          `INSERT INTO media_pipeline.clips (id, proposal_id, media_id, job_id, tenant_id, product_id, start_time, end_time, duration_seconds, source_key, title, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
          [clipId_new, clipId, p.media_id, p.job_id, p.tenant_id, p.product_id, p.start_time, p.end_time, clipDuration, sourceKey, p.title],
        );

        await client.query(
          `UPDATE media_pipeline.clip_proposals SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
          [clipId],
        );

        await client.query(
          `INSERT INTO media_pipeline.outbox_events (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
           VALUES ($1, 'MediaContentPlanApproved', $2::jsonb, $3, NULL, $4, $5, $6, $7)`,
          [uuid(), JSON.stringify({ mediaId: p.media_id, jobId: p.job_id, planId: p.id, approvedClipIds: [clipId_new] }), uuid(), uuid(), p.tenant_id, p.product_id, new Date().toISOString()],
        );

        await client.query('COMMIT');
        client.release();
        return c.json({ clip: { id: clipId_new, sourceKey, status: 'pending' } }, 201);

      } else if (action === 'reject') {
        await client.query(
          `UPDATE media_pipeline.clip_proposals SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
          [clipId],
        );
        await client.query('COMMIT');
        client.release();
        return c.json({ status: 'rejected' });

      } else {
        const updates: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        if (title) { updates.push(`title = $${idx++}`); params.push(title); }
        if (hook) { updates.push(`hook = $${idx++}`); params.push(hook); }
        if (description) { updates.push(`description = $${idx++}`); params.push(description); }
        if (hashtags) { updates.push(`hashtags = $${idx++}`); params.push(JSON.stringify(hashtags)); }
        if (startTime) { updates.push(`start_time = $${idx++}`); params.push(startTime); }
        if (endTime) { updates.push(`end_time = $${idx++}`); params.push(endTime); }

        if (updates.length > 0) {
          params.push(clipId);
          updates.push(`updated_at = NOW()`);
          await client.query(
            `UPDATE media_pipeline.clip_proposals SET ${updates.join(', ')} WHERE id = $${idx}`,
            params,
          );
        }

        await client.query('COMMIT');
        client.release();
        return c.json({ status: 'modified' });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    console.error('Update clip failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/media/:mediaId/assets', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');

    const result = await query(
      `SELECT ca.id, ca.clip_id, ca.format, ca.width, ca.height, ca.key,
              ca.file_size, ca.duration_ms, ca.mime_type, ca.has_captions,
              ca.has_branding, ca.is_public, ca.public_url, ca.published_at,
              ca.checksum, ca.created_at
       FROM media_pipeline.clip_assets ca
       WHERE ca.media_id = $1
       ORDER BY ca.created_at DESC`,
      [mediaId],
    );

    return c.json({ assets: result.rows });
  } catch (err) {
    console.error('Get assets failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/assets/:assetId/private-url', async (c) => {
  try {
    const assetId = c.req.param('assetId');

    const result = await query(
      `SELECT key, mime_type FROM media_pipeline.clip_assets WHERE id = $1`,
      [assetId],
    );
    if (result.rowCount === 0) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const url = await presignedGetUrl(result.rows[0].key, env.MEDIA_PRIVATE_URL_TTL_SECONDS);
    return c.json({
      url,
      key: result.rows[0].key,
      mimeType: result.rows[0].mime_type,
      expiresInSeconds: env.MEDIA_PRIVATE_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error('Get private URL failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/assets/:assetId/publish', async (c) => {
  try {
    const assetId = c.req.param('assetId');

    const result = await query(
      `SELECT id, media_id, tenant_id, key, mime_type, file_size, duration_ms, width, height, checksum
       FROM media_pipeline.clip_assets WHERE id = $1`,
      [assetId],
    );
    if (result.rowCount === 0) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const asset = result.rows[0];
    const publicUrl = `${env.MEDIA_PUBLIC_BASE_URL}/${asset.tenant_id}/${asset.key}`;

    await query(
      `UPDATE media_pipeline.clip_assets SET is_public = true, public_url = $1, published_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [publicUrl, assetId],
    );

    return c.json({ assetId, publicUrl, status: 'published' });
  } catch (err) {
    console.error('Publish asset failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/assets/:assetId/unpublish', async (c) => {
  try {
    const assetId = c.req.param('assetId');

    await query(
      `UPDATE media_pipeline.clip_assets SET is_public = false, public_url = NULL, updated_at = NOW() WHERE id = $1`,
      [assetId],
    );

    return c.json({ assetId, status: 'unpublished' });
  } catch (err) {
    console.error('Unpublish asset failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

const createPublicationSchema = z.object({
  mediaId: z.string().uuid(),
  channels: z.array(z.string()).min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  hashtags: z.array(z.string()),
  scheduledAt: z.string().datetime().optional(),
});

router.post('/api/v1/publications', async (c) => {
  try {
    const body = await c.req.json();
    const validation = createPublicationSchema.safeParse(body);
    if (!validation.success) {
      return c.json({ error: 'Invalid input', details: validation.error.flatten() }, 400);
    }

    const { mediaId, channels, scheduledAt } = validation.data;

    const assetResult = await query(
      `SELECT ca.id, ca.key, ca.format, ca.is_public, ca.public_url,
              ma.tenant_id, ma.product_id
       FROM media_pipeline.clip_assets ca
       JOIN media_pipeline.media_assets ma ON ma.id = ca.media_id
       WHERE ca.media_id = $1 AND ca.is_public = true
       LIMIT 1`,
      [mediaId],
    );

    if (assetResult.rowCount === 0) {
      return c.json({ error: 'No published assets found for this media' }, 400);
    }

    const asset = assetResult.rows[0];
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const publicationId = uuid();
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO media_pipeline.media_publications (id, media_id, job_id, tenant_id, product_id, status, scheduled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $7)`,
        [publicationId, mediaId, mediaId, asset.tenant_id, asset.product_id, scheduledAt || null, now],
      );

      for (const channel of channels) {
        const externalId = uuid();
        await client.query(
          `INSERT INTO media_pipeline.postiz_publications (id, publication_id, media_id, tenant_id, channel, external_id, status, idempotency_key, scheduled_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $9)`,
          [uuid(), publicationId, mediaId, asset.tenant_id, channel, externalId, uuid(), scheduledAt || null, now],
        );
      }

      await client.query(
        `INSERT INTO media_pipeline.outbox_events (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
         VALUES ($1, 'PublishingSubmitted', $2::jsonb, $3, NULL, $4, $5, $6, $7)`,
        [uuid(), JSON.stringify({ mediaId, publicationId }), uuid(), uuid(), asset.tenant_id, asset.product_id, now],
      );

      await client.query('COMMIT');
      client.release();

      return c.json({ publicationId, channels, status: 'draft' }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    console.error('Create publication failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/publications', async (c) => {
  try {
    const mediaId = c.req.query('mediaId');
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (mediaId) {
      conditions.push(`mp.media_id = $${idx++}`);
      params.push(mediaId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT mp.id, mp.media_id, mp.tenant_id, mp.status, mp.scheduled_at,
              pp.id as postiz_id, pp.channel, pp.external_id, pp.status as postiz_status,
              pp.public_url, pp.published_at, pp.error_message
       FROM media_pipeline.media_publications mp
       LEFT JOIN media_pipeline.postiz_publications pp ON pp.publication_id = mp.id
       ${where}
       ORDER BY mp.created_at DESC`,
      params,
    );

    return c.json({ publications: result.rows });
  } catch (err) {
    console.error('List publications failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/publications/:id/publish', async (c) => {
  try {
    const publicationId = c.req.param('id');

    const result = await query(
      `SELECT id FROM media_pipeline.media_publications WHERE id = $1`,
      [publicationId],
    );
    if (result.rowCount === 0) {
      return c.json({ error: 'Publication not found' }, 404);
    }

    const now = new Date().toISOString();

    await query(
      `INSERT INTO media_pipeline.outbox_events (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
       VALUES ($1, 'PublishRequested', $2::jsonb, $3, NULL, $4, $5, $6, $7)`,
      [uuid(), JSON.stringify({ publicationId }), uuid(), uuid(), '_', '_', now],
    );

    return c.json({ publicationId, status: 'publishing' });
  } catch (err) {
    console.error('Publish failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/publications/:id/cancel', async (c) => {
  try {
    const publicationId = c.req.param('id');

    await query(
      `UPDATE media_pipeline.media_publications SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [publicationId],
    );
    await query(
      `UPDATE media_pipeline.postiz_publications SET status = 'cancelled', updated_at = NOW() WHERE publication_id = $1`,
      [publicationId],
    );

    return c.json({ publicationId, status: 'cancelled' });
  } catch (err) {
    console.error('Cancel publication failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/publications/:id/status', async (c) => {
  try {
    const publicationId = c.req.param('id');

    const result = await query(
      `SELECT pp.id, pp.channel, pp.external_id, pp.status, pp.public_url,
              pp.published_at, pp.error_message, pp.attempt_count
       FROM media_pipeline.postiz_publications pp
       WHERE pp.publication_id = $1`,
      [publicationId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'Publication not found' }, 404);
    }

    return c.json({ channels: result.rows });
  } catch (err) {
    console.error('Get publication status failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
