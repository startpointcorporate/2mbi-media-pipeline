import redis from './redis.js';
import { parseEnv } from './env.js';
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from './backoff.js';

const DEFAULT_BACKOFF = [30, 120, 600];

export interface RetryEntry {
  command: Record<string, unknown>;
  step: string;
  attempt: number;
  scheduledAt: string;
}

function getBackoff(step: string, attempt: number): number {
  const backoffs = BACKOFF_SECONDS[step] ?? DEFAULT_BACKOFF;
  const index = Math.min(attempt, backoffs.length - 1);
  return backoffs[index]!;
}

function getTargetStream(step: string, env: ReturnType<typeof parseEnv>): string {
  const mediaSteps = new Set([
    'IngestionRequested',
    'TranscriptionRequested',
    'RenderVideoRequested',
    'RenderImageRequested',
  ]);
  return mediaSteps.has(step) ? env.STREAM_MEDIA : env.STREAM_EDITORIAL;
}

export async function scheduleRetry(
  step: string,
  command: Record<string, unknown>,
  attempt: number,
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    await sendToDlq(command, `Exceeded max retries (${MAX_ATTEMPTS}) for step: ${step}`);
    return;
  }

  const env = parseEnv();
  const backoffSeconds = getBackoff(step, attempt);
  const score = Date.now() + backoffSeconds * 1000;
  const entry: RetryEntry = {
    command,
    step,
    attempt: attempt + 1,
    scheduledAt: new Date().toISOString(),
  };
  await redis.zadd(env.RETRY_SCHEDULE_KEY, score, JSON.stringify(entry));
}

export async function sendToDlq(
  command: Record<string, unknown>,
  error: string,
): Promise<void> {
  const env = parseEnv();
  const dlqEntry = {
    command,
    error,
    timestamp: new Date().toISOString(),
  };
  await redis.xadd(env.DLQ_STREAM, '*', 'payload', JSON.stringify(dlqEntry));
}

export async function processRetrySchedule(): Promise<void> {
  const env = parseEnv();
  const now = Date.now();
  const entries = await redis.zrangebyscore(env.RETRY_SCHEDULE_KEY, 0, now);

  for (const raw of entries) {
    let entry: RetryEntry;
    try {
      entry = JSON.parse(raw) as RetryEntry;
    } catch {
      await redis.zrem(env.RETRY_SCHEDULE_KEY, raw);
      continue;
    }

    const targetStream = getTargetStream(entry.step, env);
    try {
      await redis.xadd(targetStream, '*', 'payload', JSON.stringify(entry.command));
      await redis.zrem(env.RETRY_SCHEDULE_KEY, raw);
    } catch (err) {
      console.error(`Failed to republish retry for ${entry.step}:`, err);
    }
  }
}
