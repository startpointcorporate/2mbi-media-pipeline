import os from 'node:os';
import { EventEnvelope } from '@2mbi/contracts';
import redis from './redis.js';
import { parseEnv } from './env.js';
import {
  handleMediaUploaded,
  handleMediaIngestionCompleted,
  handleTranscriptionCompleted,
  handleMediaContentPlanGenerated,
  handleMediaContentPlanApproved,
  handleRenderCompleted,
  handlePublishingCompleted,
} from './handlers/media-uploaded.js';
import { processRetrySchedule, scheduleRetry } from './retry.js';

const handlers: Record<string, (event: EventEnvelope) => Promise<void>> = {
  MediaUploaded: handleMediaUploaded,
  MediaIngestionCompleted: handleMediaIngestionCompleted,
  TranscriptionCompleted: handleTranscriptionCompleted,
  MediaContentPlanGenerated: handleMediaContentPlanGenerated,
  MediaContentPlanApproved: handleMediaContentPlanApproved,
  RenderCompleted: handleRenderCompleted,
  PublishingCompleted: handlePublishingCompleted,
};

async function ensureConsumerGroup(): Promise<void> {
  const env = parseEnv();
  try {
    await redis.call('XGROUP', 'CREATE', env.REDIS_MEDIA_EVENTS_STREAM, env.CONSUMER_GROUP, '$', 'MKSTREAM');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      return;
    }
    throw err;
  }
}

async function startEventConsumer(): Promise<void> {
  const env = parseEnv();
  const consumer = `orchestrator-${os.hostname()}`;

  await ensureConsumerGroup();

  while (true) {
    try {
      const result = await redis.call(
        'XREADGROUP',
        'GROUP', env.CONSUMER_GROUP, consumer,
        'COUNT', '10',
        'BLOCK', '5000',
        'STREAMS', env.REDIS_MEDIA_EVENTS_STREAM,
        '>',
      );

      if (!result) {
        await processRetrySchedule();
        continue;
      }

      const streams = result as Array<[string, Array<[string, Array<string>]>]>;
      for (const [, messages] of streams) {
        for (const [messageId, fields] of messages) {
          const payloadIdx = fields.indexOf('payload');
          if (payloadIdx === -1 || payloadIdx + 1 >= fields.length) continue;

          const raw = fields[payloadIdx + 1];

          const parsed = EventEnvelope.safeParse(JSON.parse(raw as string));
          if (!parsed.success) {
            console.error(`Invalid event envelope for message ${messageId}:`, parsed.error);
            await redis.call('XACK', env.REDIS_MEDIA_EVENTS_STREAM, env.CONSUMER_GROUP, messageId);
            await redis.xadd(env.REDIS_DEAD_LETTER_STREAM, '*', 'payload', JSON.stringify({
              originalRaw: raw,
              errors: parsed.error.flatten(),
              timestamp: new Date().toISOString(),
            }));
            continue;
          }

          const event = parsed.data;

          const handler = handlers[event.messageType];
          if (handler) {
            try {
              await handler(event);
              await redis.call('XACK', env.REDIS_MEDIA_EVENTS_STREAM, env.CONSUMER_GROUP, messageId);
            } catch (err) {
              console.error(`Handler failed for ${event.messageType} (${messageId}):`, err);
              await scheduleRetry(event.messageType, { originalEvent: event }, 0);
              await redis.call('XACK', env.REDIS_MEDIA_EVENTS_STREAM, env.CONSUMER_GROUP, messageId);
            }
          } else {
            await redis.call('XACK', env.REDIS_MEDIA_EVENTS_STREAM, env.CONSUMER_GROUP, messageId);
          }
        }
      }

      await processRetrySchedule();
    } catch (err) {
      console.error('Orchestrator loop error:', err);
    }
  }
}

async function startRetryScheduler(): Promise<void> {
  while (true) {
    await processRetrySchedule();
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

export async function startOrchestrator(): Promise<void> {
  await Promise.all([
    startEventConsumer(),
    startRetryScheduler(),
  ]);
}
