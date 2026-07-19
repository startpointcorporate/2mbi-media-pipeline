import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  MEDIA_API_URL: z.string().url().default('http://localhost:3001'),
  STREAM_TASKS: z.string().default('stream:editorial-tasks'),
  WORKER_PORT: z.string().default('3003').transform(v => parseInt(v, 10)),
  CONSUMER_GROUP: z.string().default('group:editorial-workers'),
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
