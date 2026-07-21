import { z } from 'zod';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { query, getClient } from '../db.js';
import { putObject } from '../minio.js';
import { uuid } from '../lib/crypto.js';
import { authenticateRequest } from '../auth.js';
import crypto from 'node:crypto';

interface AppVariables {
  tenantId: string;
}

const router = new Hono<{ Variables: AppVariables }>();

async function authMiddleware(c: Context, next: Next) {
  const tenantId = c.req.header('x-tenant-id');
  const apiKey = c.req.header('x-api-key');
  const apiSecret = c.req.header('x-api-secret');
  const timestamp = c.req.header('x-timestamp');
  const nonce = c.req.header('x-nonce');

  const resolvedTenant = await authenticateRequest(tenantId, apiKey, apiSecret, timestamp, nonce);
  if (!resolvedTenant) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  c.set('tenantId', resolvedTenant);
  await next();
}

router.use('/api/*', authMiddleware);

const uploadBodySchema = z.object({
  file: z.instanceof(File),
  productId: z.string().min(1),
  pipelineProfile: z.string().min(1).optional(),
});

router.post('/api/v1/media/upload', async (c) => {
  try {
    const tenantId = c.get('tenantId') as string;
    const body = await c.req.parseBody();
    const validation = uploadBodySchema.safeParse(body);
    if (!validation.success) {
      return c.json({ error: 'Invalid input', details: validation.error.flatten() }, 400);
    }

    const { file, productId } = validation.data;
    const pipelineProfile = validation.data.pipelineProfile ?? 'default';

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileSize = buffer.length;
    const filename = file.name;
    const mimeType = file.type || 'application/octet-stream';

    const mediaId = uuid();
    const jobId = uuid();
    const correlationId = uuid();
    const idempotencyKey = uuid();
    const now = new Date().toISOString();
    const sourceKey = `masters/${tenantId}/${mediaId}/${filename}`;

    await putObject(sourceKey, buffer, mimeType);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO media_pipeline.media_assets
          (id, tenant_id, product_id, original_filename, mime_type, file_size, sha256, source_key, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $9)`,
        [mediaId, tenantId, productId, filename, mimeType, fileSize, sha256, sourceKey, now],
      );

      await client.query(
        `INSERT INTO media_pipeline.media_jobs
          (id, media_asset_id, tenant_id, product_id, pipeline_profile, workflow_version, status, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
        [jobId, mediaId, tenantId, productId, pipelineProfile, '1.0', correlationId, now],
      );

      await client.query(
        `INSERT INTO media_pipeline.outbox_events
          (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
         VALUES ($1, 'MediaUploaded', $2::jsonb, $3, NULL, $4, $5, $6, $7)`,
        [
          uuid(),
          JSON.stringify({
            mediaId,
            jobId,
            tenantId,
            productId,
            originalFilename: filename,
            mimeType,
            fileSize,
            sha256,
            sourceKey,
          }),
          correlationId,
          idempotencyKey,
          tenantId,
          productId,
          now,
        ],
      );

      await client.query('COMMIT');
      client.release();

      return c.json({ mediaId, jobId }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    console.error('Upload failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/jobs', async (c) => {
  try {
    const tenantId = c.get('tenantId') as string;
    const productId = c.req.query('productId');
    const status = c.req.query('status');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    conditions.push(`tenant_id = $${idx++}`);
    params.push(tenantId);

    if (productId) {
      conditions.push(`product_id = $${idx++}`);
      params.push(productId);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*)::int as total FROM media_pipeline.media_jobs ${where}`,
      params,
    );
    const total = countResult.rows[0].total;

    const jobsResult = await query(
      `SELECT id, media_asset_id, tenant_id, product_id, pipeline_profile, workflow_version,
              status, correlation_id, error_message, version, created_at, updated_at
       FROM media_pipeline.media_jobs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    );

    return c.json({ jobs: jobsResult.rows, total });
  } catch (err) {
    console.error('List jobs failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/jobs/:id', async (c) => {
  try {
    const jobId = c.req.param('id');

    const jobResult = await query(
      `SELECT id, media_asset_id, tenant_id, product_id, pipeline_profile, workflow_version,
              status, correlation_id, error_message, version, created_at, updated_at
       FROM media_pipeline.media_jobs
       WHERE id = $1`,
      [jobId],
    );

    if (jobResult.rowCount === 0) {
      return c.json({ error: 'Job not found' }, 404);
    }

    const stepsResult = await query(
      `SELECT id, job_id, step_name, status, started_at, completed_at, attempt_count,
              max_attempts, error_message, result, worker_id, last_heartbeat_at,
              lease_expires_at, created_at
       FROM media_pipeline.media_job_steps
       WHERE job_id = $1
       ORDER BY created_at`,
      [jobId],
    );

    return c.json({
      job: jobResult.rows[0],
      steps: stepsResult.rows,
    });
  } catch (err) {
    console.error('Get job failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'media-pipeline-api' });
});

export default router;
