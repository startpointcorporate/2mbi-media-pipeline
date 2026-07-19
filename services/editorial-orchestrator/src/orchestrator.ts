import os from 'node:os';
import type { EventEnvelope } from '@2mbi/contracts';
import redis from './redis.js';
import { parseEnv } from './env.js';
import { handleMediaUploaded } from './handlers/media-uploaded.js';

const handlers: Record<string, (event: EventEnvelope) => Promise<void>> = {
  MediaUploaded: handleMediaUploaded,
};

async function ensureConsumerGroup(): Promise<void> {
  const env = parseEnv();
  try {
    await redis.call('XGROUP', 'CREATE', env.STREAM_EVENTS, env.CONSUMER_GROUP, '$', 'MKSTREAM');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      return;
    }
    throw err;
  }
}

export async function startOrchestrator(): Promise<void> {
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
        'STREAMS', env.STREAM_EVENTS,
        '>',
      );

      if (!result) continue;

      const streams = result as Array<[string, Array<[string, Array<string>]>]>;
      for (const [, messages] of streams) {
        for (const [messageId, fields] of messages) {
          const payloadIdx = fields.indexOf('payload');
          if (payloadIdx === -1 || payloadIdx + 1 >= fields.length) continue;

          const raw = fields[payloadIdx + 1];
          let event: EventEnvelope;
          try {
            event = JSON.parse(raw as string) as EventEnvelope;
          } catch {
            await redis.call('XACK', env.STREAM_EVENTS, env.CONSUMER_GROUP, messageId);
            continue;
          }

          const handler = handlers[event.messageType];
          if (handler) {
            try {
              await handler(event);
            } catch (err) {
              console.error(`Handler failed for ${event.messageType} (${messageId}):`, err);
            }
          }

          await redis.call('XACK', env.STREAM_EVENTS, env.CONSUMER_GROUP, messageId);
        }
      }
    } catch (err) {
      console.error('Orchestrator loop error:', err);
    }
  }
}
