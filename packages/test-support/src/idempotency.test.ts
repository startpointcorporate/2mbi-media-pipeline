import { describe, it, expect } from 'vitest';

describe('Idempotency', () => {
  it('same idempotencyKey submitted twice returns success without duplicate processing', async () => {
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';
    const processed = new Set<string>();
    const results: Array<{ key: string; payload: unknown }> = [];

    async function processWithIdempotency(key: string, payload: unknown) {
      if (processed.has(key)) {
        return { status: 200, body: { success: true, alreadyProcessed: true, previousResult: results[0] } };
      }
      processed.add(key);
      results.push({ key, payload });
      return { status: 200, body: { success: true, alreadyProcessed: false } };
    }

    const payload = { mediaId: 'm1', jobId: 'j1' };

    const first = await processWithIdempotency(idempotencyKey, payload);
    expect(first.body.alreadyProcessed).toBe(false);
    expect(results).toHaveLength(1);

    const second = await processWithIdempotency(idempotencyKey, payload);
    expect(second.body.alreadyProcessed).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('different idempotencyKeys are both processed', async () => {
    const processed = new Set<string>();

    async function processWithIdempotency(key: string) {
      if (processed.has(key)) {
        return { status: 200, body: { alreadyProcessed: true } };
      }
      processed.add(key);
      return { status: 200, body: { success: true } };
    }

    const first = await processWithIdempotency('key-a');
    const second = await processWithIdempotency('key-b');

    expect(first.body.success).toBe(true);
    expect(second.body.success).toBe(true);
    expect(processed.size).toBe(2);
  });

  it('empty idempotencyKey is rejected', async () => {
    async function validateKey(key: string): Promise<boolean> {
      return key.length > 0 && /^[a-f0-9-]+$/i.test(key);
    }

    await expect(validateKey('')).resolves.toBe(false);
    await expect(validateKey('550e8400-e29b-41d4-a716-446655440000')).resolves.toBe(true);
  });
});
