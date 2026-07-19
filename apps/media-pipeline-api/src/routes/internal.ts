import { Hono } from 'hono';
import { WorkerResultPayload, HeartbeatPayload } from '@2mbi/contracts';
import { query } from '../db.js';
import { uuid } from '../lib/crypto.js';

const router = new Hono();

router.post('/internal/worker-results', async (c) => {
  try {
    const body = WorkerResultPayload.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.flatten() }, 400);
    }

    const { jobId, stepId, idempotencyKey, resultType, result } = body.data;

    const existing = await query(
      `SELECT id, status FROM media_pipeline.media_job_steps WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    if (existing.rowCount !== null && existing.rowCount > 0) {
      return c.json({ status: 'already_processed' });
    }

    const now = new Date().toISOString();
    const correlationId = uuid();
    const eventId = uuid();

    await query('BEGIN');
    try {
      await query(
        `UPDATE media_pipeline.media_job_steps
           SET status = 'completed', result = $1::jsonb, completed_at = $2, updated_at = $2
         WHERE id = $3`,
        [JSON.stringify(result), now, stepId],
      );

      await query(
        `UPDATE media_pipeline.media_jobs
           SET status = 'running', updated_at = $1
         WHERE id = $2`,
        [now, jobId],
      );

      await query(
        `INSERT INTO media_pipeline.outbox_events
           (id, event_type, payload, correlation_id, causation_id, idempotency_key, created_at)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $6)`,
        [
          eventId,
          resultType,
          JSON.stringify({ jobId, stepId, ...result }),
          correlationId,
          idempotencyKey,
          now,
        ],
      );

      await query('COMMIT');
      return c.json({ status: 'ok' });
    } catch (err) {
      await query('ROLLBACK');
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
