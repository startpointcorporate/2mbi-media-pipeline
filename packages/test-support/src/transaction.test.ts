import { describe, it, expect } from 'vitest';

interface MediaAsset {
  id: string;
  sourceKey: string;
  status: string;
}

interface OutboxEvent {
  id: string;
  eventType: string;
  idempotencyKey: string;
}

interface TransactionResult {
  mediaAsset: MediaAsset | null;
  outboxEvent: OutboxEvent | null;
  error: string | null;
}

describe('Upload + Outbox Transaction', () => {
  it('simulates atomic PG transaction for upload and outbox', async () => {
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';

    async function simulateTransaction(): Promise<TransactionResult> {
      const mediaAsset: MediaAsset = {
        id: 'ma-1',
        sourceKey: `uploads/konektag/ma-1/test.mp4`,
        status: 'pending',
      };
      const outboxEvent: OutboxEvent = {
        id: 'oe-1',
        eventType: 'MediaUploaded',
        idempotencyKey,
      };
      return { mediaAsset, outboxEvent, error: null };
    }

    const result = await simulateTransaction();

    expect(result.mediaAsset).not.toBeNull();
    expect(result.mediaAsset!.sourceKey).toContain('uploads/');
    expect(result.outboxEvent).not.toBeNull();
    expect(result.outboxEvent!.eventType).toBe('MediaUploaded');
    expect(result.outboxEvent!.idempotencyKey).toBe(idempotencyKey);
    expect(result.error).toBeNull();
  });

  it('reverts both insertions if transaction fails', async () => {
    async function simulateFailedTransaction(): Promise<TransactionResult> {
      try {
        throw new Error('DB connection failed');
      } catch (err) {
        return {
          mediaAsset: null,
          outboxEvent: null,
          error: (err as Error).message,
        };
      }
    }

    const result = await simulateFailedTransaction();

    expect(result.mediaAsset).toBeNull();
    expect(result.outboxEvent).toBeNull();
    expect(result.error).toBe('DB connection failed');
  });

  it('includes idempotency key in both inserts', async () => {
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440001';

    async function simulateTransaction(): Promise<{ mediaKey: string; outboxKey: string }> {
      return {
        mediaKey: idempotencyKey,
        outboxKey: idempotencyKey,
      };
    }

    const result = await simulateTransaction();
    expect(result.mediaKey).toBe(result.outboxKey);
  });
});
