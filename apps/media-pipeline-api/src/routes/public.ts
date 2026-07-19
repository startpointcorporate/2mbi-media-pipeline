import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../db.js';
import { putObject } from '../minio.js';
import { uuid } from '../lib/crypto.js';

const router = new Hono();

const UploadBody = z.object({
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
  mimeType: z.string().min(1),
  tenantId: z.string().min(1),
  productId: z.string().min(1),
});

router.post('/api/v1/media/upload', async (c) => {
  try {
    const body = UploadBody.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.flatten() }, 400);
    }

    const { filename, contentBase64, mimeType, tenantId, productId } = body.data;

    const mediaId = uuid();
    const jobId = uuid();
    const correlationId = uuid();
    const idempotencyKey = uuid();
    const now = new Date().toISOString();

    const buffer = Buffer.from(contentBase64, 'base64');
    const fileSize = buffer.length;
    const sourceKey = `media-source/${tenantId}/${mediaId}/${filename}`;

    await putObject('media-source', sourceKey, buffer, mimeType);

    await query('BEGIN');
    try {
      await query(
        `INSERT INTO media_pipeline.media_assets
          (id, tenant_id, product_id, original_filename, mime_type, file_size, source_key, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)`,
        [mediaId, tenantId, productId, filename, mimeType, fileSize, sourceKey, now],
      );

      await query(
        `INSERT INTO media_pipeline.media_jobs
          (id, media_asset_id, tenant_id, product_id, pipeline_profile, workflow_version, status, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
        [jobId, mediaId, tenantId, productId, productId, '1.0', correlationId, now],
      );

      await query(
        `INSERT INTO media_pipeline.outbox_events
          (id, event_type, payload, correlation_id, causation_id, idempotency_key, created_at)
         VALUES ($1, 'MediaUploaded', $2::jsonb, $3, NULL, $4, $5)`,
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
            sourceKey,
          }),
          correlationId,
          idempotencyKey,
          now,
        ],
      );

      await query('COMMIT');

      return c.json({ mediaId, jobId }, 201);
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('Upload failed', err);
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
