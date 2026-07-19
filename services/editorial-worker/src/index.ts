import os from 'node:os';
import http from 'node:http';
import { Redis } from 'ioredis';
import { parseEnv } from './env.js';

const env = parseEnv();

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error('Redis error', err);
});

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.call('XGROUP', 'CREATE', env.STREAM_TASKS, env.CONSUMER_GROUP, '$', 'MKSTREAM');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      return;
    }
    throw err;
  }
}

async function startWorker(): Promise<void> {
  const consumer = `editorial-worker-${os.hostname()}`;
  await ensureConsumerGroup();

  while (true) {
    try {
      const result = await redis.call(
        'XREADGROUP',
        'GROUP', env.CONSUMER_GROUP, consumer,
        'COUNT', '5',
        'BLOCK', '5000',
        'STREAMS', env.STREAM_TASKS,
        '>',
      );

      if (!result) continue;

      const streams = result as Array<[string, Array<[string, Array<string>]>]>;
      for (const [, messages] of streams) {
        for (const [messageId, fields] of messages) {
          const payloadIdx = fields.indexOf('payload');
          if (payloadIdx === -1 || payloadIdx + 1 >= fields.length) continue;

          const raw = fields[payloadIdx + 1];
          try {
            const command = JSON.parse(raw as string);
            console.log(`Received command: ${command.step} (${messageId})`, JSON.stringify(command.data));
          } catch {
            console.error(`Failed to parse message ${messageId}`);
          }

          await redis.call('XACK', env.STREAM_TASKS, env.CONSUMER_GROUP, messageId);
        }
      }
    } catch (err) {
      console.error('Worker loop error:', err);
    }
  }
}

function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'editorial-worker' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(env.WORKER_PORT, () => {
    console.log(`Health server listening on port ${env.WORKER_PORT}`);
  });

  server.on('error', (err) => {
    console.error('Health server error:', err);
  });
}

startHealthServer();

startWorker().catch((err) => {
  console.error('Worker exited:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await redis.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await redis.quit();
  process.exit(0);
});
