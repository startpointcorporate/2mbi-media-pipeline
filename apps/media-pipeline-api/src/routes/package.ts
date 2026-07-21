import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import crypto from 'node:crypto';
import { query, getClient } from '../db.js';
import { presignedGetUrl, putObject, getObject } from '../minio.js';
import { uuid } from '../lib/crypto.js';
import { generatePackage } from '../package-builder.js';

interface AppVariables {
  tenantId: string;
}

const router = new Hono<{ Variables: AppVariables }>();

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

router.post('/api/v1/media/:mediaId/package/generate', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const tenantId = c.get('tenantId') as string;

    const media = await query(
      `SELECT id, tenant_id, product_id FROM media_pipeline.media_assets WHERE id = $1 AND tenant_id = $2`,
      [mediaId, tenantId],
    );
    if (media.rowCount === 0) {
      return c.json({ error: 'Media not found' }, 404);
    }

    const existing = await query(
      `SELECT id, status FROM media_pipeline.media_packages WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [mediaId],
    );
    if (existing.rowCount && existing.rowCount > 0 && ['publishing', 'published'].includes(existing.rows[0].status as string)) {
      return c.json({ error: 'Package already published', packageId: existing.rows[0].id }, 409);
    }

    const packageId = uuid();
    const now = new Date().toISOString();

    const client = await getClient();
    try {
      await client.query(
        `INSERT INTO media_pipeline.media_packages (id, media_id, job_id, tenant_id, product_id, status, created_at, updated_at)
         VALUES ($1, $2, $2, $3, $4, 'generating', $5, $5)`,
        [packageId, mediaId, tenantId, media.rows[0].product_id, now],
      );
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }

    generatePackage(mediaId)
      .then(async (result) => {
        await query(
          `UPDATE media_pipeline.media_packages
           SET status = 'ready', package_key = $1, file_size = $2, checksum = $3, asset_count = $4, updated_at = NOW()
           WHERE id = $5`,
          [result.packageKey, result.fileSize, result.checksum, result.assetCount, packageId],
        );
      })
      .catch(async (err) => {
        console.error('Package generation failed:', err);
        await query(
          `UPDATE media_pipeline.media_packages
           SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE id = $2`,
          [String(err), packageId],
        );
      });

    return c.json({ packageId, status: 'generating' }, 202);
  } catch (err) {
    console.error('Package generate failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/api/v1/media/:mediaId/package', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const tenantId = c.get('tenantId') as string;

    const result = await query(
      `SELECT mp.id, mp.status, mp.package_key, mp.modified_key, mp.archive_key,
              mp.file_size, mp.checksum, mp.clip_count, mp.asset_count,
              mp.youtube_metadata, mp.post_proposals, mp.validation_notes,
              mp.validated_at, mp.published_at, mp.archived_at,
              mp.error_message, mp.created_at, mp.updated_at
       FROM media_pipeline.media_packages mp
       WHERE mp.media_id = $1 AND mp.tenant_id = $2
       ORDER BY mp.created_at DESC LIMIT 1`,
      [mediaId, tenantId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'No package found' }, 404);
    }

    const pkg = result.rows[0];
    const response: Record<string, unknown> = {
      packageId: pkg.id,
      status: pkg.status,
      fileSize: pkg.file_size,
      checksum: pkg.checksum,
      assetCount: pkg.asset_count,
      validationNotes: pkg.validation_notes,
      validatedAt: pkg.validated_at,
      publishedAt: pkg.published_at,
      archivedAt: pkg.archived_at,
      errorMessage: pkg.error_message,
      createdAt: pkg.created_at,
    };

    const activeKey = pkg.modified_key || pkg.package_key;
    if (activeKey && ['ready', 'downloaded', 'modified', 'validated'].includes(pkg.status as string)) {
      response.downloadUrl = await presignedGetUrl(activeKey as string, 3600);
      response.downloadKey = activeKey;
    }

    if (pkg.post_proposals) {
      response.postProposals = typeof pkg.post_proposals === 'string'
        ? JSON.parse(pkg.post_proposals as string)
        : pkg.post_proposals;
    }
    if (pkg.youtube_metadata) {
      response.youtubeMetadata = typeof pkg.youtube_metadata === 'string'
        ? JSON.parse(pkg.youtube_metadata as string)
        : pkg.youtube_metadata;
    }

    return c.json(response);
  } catch (err) {
    console.error('Get package failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/media/:mediaId/package/modify', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const tenantId = c.get('tenantId') as string;

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return c.json({ error: 'file is required' }, 400);
    }

    const result = await query(
      `SELECT id, status FROM media_pipeline.media_packages
       WHERE media_id = $1 AND tenant_id = $2 AND status IN ('ready', 'downloaded', 'modified', 'validated')
       ORDER BY created_at DESC LIMIT 1`,
      [mediaId, tenantId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'No modifiable package found' }, 404);
    }

    const pkg = result.rows[0];
    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const modifiedKey = `packages/${mediaId}/modified-${Date.now()}.zip`;

    await putObject(modifiedKey, buffer, 'application/zip');

    await query(
      `UPDATE media_pipeline.media_packages
       SET status = 'modified', modified_key = $1, file_size = $2, checksum = $3, updated_at = NOW()
       WHERE id = $4`,
      [modifiedKey, buffer.length, checksum, pkg.id],
    );

    return c.json({
      packageId: pkg.id,
      status: 'modified',
      fileSize: buffer.length,
      checksum,
    });
  } catch (err) {
    console.error('Package modify failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/media/:mediaId/package/validate', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const tenantId = c.get('tenantId') as string;

    const body = await c.req.json();
    const notes = String(body.notes || '');

    const now = new Date().toISOString();

    const result = await query(
      `UPDATE media_pipeline.media_packages
       SET status = 'validated', validation_notes = $1, validated_by = $2, validated_at = $3, updated_at = NOW()
       WHERE media_id = $4 AND tenant_id = $5 AND status IN ('modified', 'ready')
       RETURNING id`,
      [notes, `api-${tenantId}`, now, mediaId, tenantId],
    );

    if (result.rowCount === 0) {
      return c.json({ error: 'No package to validate' }, 404);
    }

    return c.json({ packageId: result.rows[0].id, status: 'validated' });
  } catch (err) {
    console.error('Package validate failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/api/v1/media/:mediaId/package/publish', async (c) => {
  try {
    const mediaId = c.req.param('mediaId');
    const tenantId = c.get('tenantId') as string;
    const now = new Date().toISOString();

    const pkgResult = await query(
      `SELECT id, modified_key, package_key FROM media_pipeline.media_packages
       WHERE media_id = $1 AND tenant_id = $2 AND status = 'validated'
       ORDER BY created_at DESC LIMIT 1`,
      [mediaId, tenantId],
    );

    if (pkgResult.rowCount === 0) {
      return c.json({ error: 'No validated package found. The package must be validated before publishing.' }, 409);
    }

    const pkg = pkgResult.rows[0];
    const finalKey = (pkg.modified_key || pkg.package_key) as string;

    const archiveKey = `archives/${tenantId}/${mediaId}/published-${Date.now()}.zip`;
    const { body } = await getObject(finalKey);
    await putObject(archiveKey, body, 'application/zip');

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE media_pipeline.media_packages
         SET status = 'published', archive_key = $1, published_at = $2, archived_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [archiveKey, now, pkg.id],
      );

      await client.query(
        `INSERT INTO media_pipeline.outbox_events
         (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
         VALUES ($1, 'PublishRequested', $2::jsonb, $3, NULL, $4, $5, '_', $6)`,
        [uuid(), JSON.stringify({ mediaId, publicationId: pkg.id }), uuid(), uuid(), tenantId, now],
      );

      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }

    return c.json({
      packageId: pkg.id,
      status: 'published',
      archiveKey,
      publishedAt: now,
    });
  } catch (err) {
    console.error('Package publish failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
