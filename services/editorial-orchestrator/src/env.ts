import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  MEDIA_API_URL: z.string().url().default('http://localhost:3001'),
  STREAM_EVENTS: z.string().default('stream:pipeline-events'),
  STREAM_MEDIA: z.string().default('stream:media-tasks'),
  STREAM_EDITORIAL: z.string().default('stream:editorial-tasks'),
  RETRY_SCHEDULE_KEY: z.string().default('media:retry:schedule'),
  DLQ_STREAM: z.string().default('stream:dead-letter'),
  ORCHESTRATOR_PORT: z.string().default('3002').transform(v => parseInt(v, 10)),
  CONSUMER_GROUP: z.string().default('group:orchestrator'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function parseEnv(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten());
    process.exit(1);
  }
  _env = result.data;
  return _env;
}
