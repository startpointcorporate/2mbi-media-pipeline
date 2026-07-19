import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/media_pipeline'),
  REDIS_URL: z.string().default('redis://:redispass@localhost:6379'),
  MINIO_ENDPOINT: z.string().default('localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_REGION: z.string().default('fr-par'),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('media-pipeline'),
  KEYCLOAK_CLIENT_ID: z.string().default('media-api'),
  KEYCLOAK_CLIENT_SECRET: z.string().default(''),
  DIRECTUS_URL: z.string().url().default('http://localhost:8055'),
  DIRECTUS_TOKEN: z.string().default(''),
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
