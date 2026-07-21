import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline_db'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  MEDIA_API_URL: z.string().url().default('http://localhost:3001'),
  STREAM_TASKS: z.string().default('2mbi:media:editorial:tasks'),
  WORKER_PORT: z.string().default('3003').transform(v => parseInt(v, 10)),
  CONSUMER_GROUP: z.string().default('2mbi:group:editorial-workers'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3:8b'),
  OLLAMA_TIMEOUT_MS: z
    .string()
    .default('180000')
    .transform((v) => parseInt(v, 10)),
  OLLAMA_TEMPERATURE: z
    .string()
    .default('0')
    .transform((v) => parseFloat(v)),
  EDITORIAL_AI_MAX_CONCURRENCY: z
    .string()
    .default('1')
    .transform((v) => parseInt(v, 10)),
  POSTIZ_BASE_URL: z.string().default(''),
  POSTIZ_API_KEY: z.string().default(''),
  INTERNAL_API_KEY: z.string().default(''),
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
