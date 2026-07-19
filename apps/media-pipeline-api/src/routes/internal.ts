import { Hono } from 'hono';
import { WorkerResultPayload, HeartbeatPayload } from '@2mbi/contracts';
import { query, getClient } from '../db.js';
import { uuid } from '../lib/crypto.js';

const router = new Hono();

router.post('/internal/worker-results', async (c) => {
  try {
    const body = WorkerResultPayload.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.flatten() }, 400);
    }

    const { jobId, stepId, idempotencyKey, resultType, result } = body.data;

    const stepResult = await query(
      `SELECT id, status, idempotency_key, job_id
       FROM media_pipeline.media_job_steps
       WHERE id = $1 AND job_id = $2`,
      [stepId, jobId],
    );
    if (stepResult.rowCount === 0) return c.json({ error: 'Step not found for this job' }, 404);
    const step = stepResult.rows[0];

    if (step.idempotency_key !== idempotencyKey) {
      return c.json({ error: 'idempotencyKey does not match step record' }, 409);
    }
    if (step.status === 'completed') return c.json({ status: 'already_processed' });
    if (step.status === 'failed') return c.json({ error: 'Step is in failed state' }, 409);

    const jobResult = await query(
      `SELECT correlation_id, tenant_id, product_id FROM media_pipeline.media_jobs WHERE id = $1`,
      [jobId],
    );
    if (jobResult.rowCount === 0) return c.json({ error: 'Job not found' }, 404);
    const { correlation_id: correlationId, tenant_id: tenantId, product_id: productId } = jobResult.rows[0];

    const now = new Date().toISOString();
    const eventId = uuid();

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const updateResult = await client.query(
        `UPDATE media_pipeline.media_job_steps
           SET status = 'completed', result = $1::jsonb, completed_at = $2, updated_at = $2
         WHERE id = $3 AND status = 'running'`,
        [JSON.stringify(result), now, stepId],
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        return c.json({ error: 'Step not in running state' }, 409);
      }

      await client.query(
        `UPDATE media_pipeline.media_jobs
           SET status = 'running', updated_at = $1
         WHERE id = $2`,
        [now, jobId],
      );

      await client.query(
        `INSERT INTO media_pipeline.outbox_events
           (id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $6, $7, $8)`,
        [
          eventId,
          resultType,
          JSON.stringify({ jobId, stepId, ...result }),
          correlationId,
          idempotencyKey,
          tenantId,
          productId,
          now,
        ],
      );

      await client.query('COMMIT');
      client.release();
      return c.json({ status: 'ok' });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    console.error('Worker results failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/internal/job-steps/:stepId/heartbeat', async (c) => {
  try {
    const stepId = c.req.param('stepId');

    const body = HeartbeatPayload.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.flatten() }, 400);
    }

    const { workerId, leaseDurationSeconds } = body.data;
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationSeconds * 1000);

    await query(
      `UPDATE media_pipeline.media_job_steps
         SET worker_id = $1, last_heartbeat_at = $2, lease_expires_at = $3, status = 'running'
       WHERE id = $4`,
      [workerId, now.toISOString(), leaseExpiresAt.toISOString(), stepId],
    );

    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('Heartbeat failed', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
