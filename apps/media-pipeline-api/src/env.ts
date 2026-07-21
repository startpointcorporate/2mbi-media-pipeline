import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline_db'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  REDIS_MEDIA_EVENTS_STREAM: z.string().default('2mbi:media:events'),
  REDIS_MEDIA_TASKS_STREAM: z.string().default('2mbi:media:tasks'),
  REDIS_EDITORIAL_TASKS_STREAM: z.string().default('2mbi:media:editorial:tasks'),
  REDIS_DEAD_LETTER_STREAM: z.string().default('2mbi:media:dead-letter'),
  MINIO_ENDPOINT: z.string().default('localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('2mbi-media'),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MEDIA_PUBLIC_BASE_URL: z.string().default('https://media.2mbiweb.com'),
  MEDIA_PRIVATE_URL_TTL_SECONDS: z
    .string()
    .default('900')
    .transform((v) => parseInt(v, 10)),
  CLIENTS_CONFIG: z.string().default(''),
  INTERNAL_API_KEY: z.string().default(''),
  MEDIA_PIPELINE_PORT: z
    .string()
    .default('3001')
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
