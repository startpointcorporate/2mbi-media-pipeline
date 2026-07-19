import { getClient } from '../db.js';
import redis from '../redis.js';

const STREAM_KEY = 'stream:pipeline-events';
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function dispatch(): Promise<void> {
  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT id, event_type, payload, correlation_id, causation_id, idempotency_key, tenant_id, product_id, created_at
         FROM media_pipeline.outbox_events
         WHERE processed_at IS NULL
         ORDER BY created_at
         LIMIT 50
         FOR UPDATE SKIP LOCKED`,
      );

      if (result.rowCount === null || result.rowCount === 0) {
        await client.query('COMMIT');
        client.release();
        return;
      }

      for (const row of result.rows) {
        try {
          const payload = {
            schemaVersion: 1,
            messageId: row.id,
            messageType: row.event_type,
            correlationId: row.correlation_id,
            causationId: row.causation_id,
            idempotencyKey: row.idempotency_key,
            tenantId: row.tenant_id,
            productId: row.product_id,
            occurredAt: row.created_at instanceof Date
              ? row.created_at.toISOString()
              : row.created_at,
            data: row.payload,
          };

          await redis.xadd(STREAM_KEY, '*', 'payload', JSON.stringify(payload));

          await client.query(
            `UPDATE media_pipeline.outbox_events
             SET processed_at = NOW(), attempts = attempts + 1
             WHERE id = $1`,
            [row.id],
          );
        } catch (err) {
          console.error('Failed to dispatch outbox event', row.id, err);
          await client.query(
            `UPDATE media_pipeline.outbox_events
             SET attempts = attempts + 1, error_message = $1
             WHERE id = $2`,
            [(err as Error).message, row.id],
          );
        }
      }

      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    console.error('Outbox dispatcher error', err);
  }
}

export function startDispatcher(): void {
  if (intervalHandle) return;
  console.log('Starting outbox dispatcher (interval: 2s)');
  intervalHandle = setInterval(dispatch, 2000);
}

export function stopDispatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
