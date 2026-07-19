import { describe, it, expect } from 'vitest';
import { EventEnvelope, WorkerResultPayload } from '@2mbi/contracts';
import { z } from 'zod';

const uuid = () => crypto.randomUUID();

interface MediaAsset {
  id: string;
  sourceKey: string;
  status: string;
  tenantId: string;
  productId: string;
}

interface MediaJob {
  id: string;
  mediaId: string;
  status: string;
}

interface OutboxEvent {
  id: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
}

describe('Walking skeleton flow', () => {
  it('simulates upload → outbox → stream → worker result → completion', async () => {
    const correlationId = uuid();
    const causationId = uuid();
    const uploadKey = uuid();
    const mediaId = uuid();
    const jobId = uuid();

    const mediaAsset: MediaAsset = {
      id: mediaId,
      sourceKey: `uploads/konektag/${mediaId}/test.mp4`,
      status: 'pending',
      tenantId: 'konektag',
      productId: 'konektag',
    };

    const mediaJob: MediaJob = {
      id: jobId,
      mediaId,
      status: 'pending',
    };

    const outboxEvent: OutboxEvent = {
      id: uuid(),
      eventType: 'MediaUploaded',
      idempotencyKey: uploadKey,
      payload: null,
    };

    const envelope = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'MediaUploaded',
      correlationId,
      causationId,
      idempotencyKey: uploadKey,
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { mediaId, jobId },
    });

    expect(envelope.idempotencyKey).toBe(uploadKey);
    expect(envelope.correlationId).toBe(correlationId);
    expect(envelope.data).toEqual({ mediaId, jobId });

    const commandEnvelope = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'IngestionRequested',
      correlationId,
      causationId: envelope.messageId,
      idempotencyKey: uuid(),
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { jobId, mediaId, tenantId: 'konektag', productId: 'konektag', sourceKey: mediaAsset.sourceKey },
    });

    expect(commandEnvelope.messageType).toBe('IngestionRequested');
    expect(commandEnvelope.data).toHaveProperty('sourceKey', mediaAsset.sourceKey);

    const workerResult = WorkerResultPayload.parse({
      jobId,
      stepId: uuid(),
      idempotencyKey: uuid(),
      resultType: 'MediaIngestionCompleted',
      result: { normalizedKey: `${mediaAsset.sourceKey.replace('.mp4', '')}/normalized.mp4`, durationSeconds: 120 },
    });

    expect(workerResult.jobId).toBe(jobId);
    expect(workerResult.resultType).toBe('MediaIngestionCompleted');
    expect(workerResult.result).toHaveProperty('normalizedKey');

    const resultEnvelope = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'MediaIngestionCompleted',
      correlationId,
      causationId: commandEnvelope.messageId,
      idempotencyKey: workerResult.idempotencyKey,
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { jobId, mediaId, normalizedKey: workerResult.result.normalizedKey, durationSeconds: 120 },
    });

    expect(resultEnvelope.correlationId).toBe(correlationId);
    expect(resultEnvelope.causationId).toBe(commandEnvelope.messageId);
    expect(mediaJob.status).toBe('pending');
    expect(mediaAsset.status).toBe('pending');
    expect(outboxEvent.eventType).toBe('MediaUploaded');

    const keys = [uploadKey, envelope.idempotencyKey, commandEnvelope.idempotencyKey, workerResult.idempotencyKey, resultEnvelope.idempotencyKey];
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(3); // upload == envelope, command == workerResult, result is unique
  });

  it('idempotency prevents duplicate processing', async () => {
    const processed = new Set<string>();
    const results: Array<{ key: string; result: WorkerResultPayload }> = [];

    async function handleWorkerResult(payload: WorkerResultPayload) {
      if (processed.has(payload.idempotencyKey)) {
        return { status: 200, body: { success: true, alreadyProcessed: true, previousResult: results[0]?.result } };
      }
      processed.add(payload.idempotencyKey);
      results.push({ key: payload.idempotencyKey, result: payload });
      return { status: 200, body: { success: true, alreadyProcessed: false } };
    }

    const payload: WorkerResultPayload = {
      jobId: uuid(),
      stepId: uuid(),
      idempotencyKey: uuid(),
      resultType: 'MediaIngestionCompleted',
      result: { normalizedKey: 'test.mp4', durationSeconds: 120 },
    };

    const first = await handleWorkerResult(payload);
    expect(first.body.alreadyProcessed).toBe(false);
    expect(results).toHaveLength(1);

    const second = await handleWorkerResult(payload);
    expect(second.body.alreadyProcessed).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('correlationId flows through entire chain', async () => {
    const rootCorrelationId = uuid();

    const envelope1 = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'MediaUploaded',
      correlationId: rootCorrelationId,
      causationId: uuid(),
      idempotencyKey: uuid(),
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { mediaId: uuid(), jobId: uuid() },
    });

    const envelope2 = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'IngestionRequested',
      correlationId: rootCorrelationId,
      causationId: envelope1.messageId,
      idempotencyKey: uuid(),
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { jobId: uuid(), mediaId: uuid(), tenantId: 'konektag', productId: 'konektag', sourceKey: 'uploads/test.mp4' },
    });

    const envelope3 = EventEnvelope.parse({
      schemaVersion: 1,
      messageId: uuid(),
      messageType: 'MediaIngestionCompleted',
      correlationId: rootCorrelationId,
      causationId: envelope2.messageId,
      idempotencyKey: uuid(),
      occurredAt: new Date().toISOString(),
      tenantId: 'konektag',
      productId: 'konektag',
      data: { jobId: uuid(), mediaId: uuid(), normalizedKey: 'test/normalized.mp4', durationSeconds: 120 },
    });

    expect(envelope1.correlationId).toBe(rootCorrelationId);
    expect(envelope2.correlationId).toBe(rootCorrelationId);
    expect(envelope3.correlationId).toBe(rootCorrelationId);

    expect(envelope2.causationId).toBe(envelope1.messageId);
    expect(envelope3.causationId).toBe(envelope2.messageId);
  });
});
