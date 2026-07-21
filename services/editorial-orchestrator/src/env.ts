import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline_db'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  MEDIA_API_URL: z.string().url().default('http://localhost:3001'),
  REDIS_MEDIA_EVENTS_STREAM: z.string().default('2mbi:media:events'),
  REDIS_MEDIA_TASKS_STREAM: z.string().default('2mbi:media:tasks'),
  REDIS_EDITORIAL_TASKS_STREAM: z.string().default('2mbi:media:editorial:tasks'),
  REDIS_DEAD_LETTER_STREAM: z.string().default('2mbi:media:dead-letter'),
  RETRY_SCHEDULE_KEY: z.string().default('2mbi:media:retry:schedule'),
  ORCHESTRATOR_PORT: z.string().default('3002').transform(v => parseInt(v, 10)),
  CONSUMER_GROUP: z.string().default('2mbi:group:orchestrator'),
  MAX_RETRY_ATTEMPTS: z
    .string()
    .default('3')
    .transform((v) => parseInt(v, 10)),
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
