import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { parseEnv } from './env.js';
import publicRoutes from './routes/public.js';
import internalRoutes from './routes/internal.js';
import mediaRoutes from './routes/media.js';
import packageRoutes from './routes/package.js';
import { startDispatcher } from './outbox/dispatcher.js';
import { ensureBucket } from './minio.js';

const app = new Hono();

app.route('/', publicRoutes);
app.route('/', internalRoutes);
app.route('/', mediaRoutes);
app.route('/', packageRoutes);

const env = parseEnv();

serve(
  {
    fetch: app.fetch,
    port: env.MEDIA_PIPELINE_PORT,
  },
  (info) => {
    console.log(`Media Pipeline API listening on http://localhost:${info.port}`);
    ensureBucket().catch((err) => {
      console.error('Failed to ensure MinIO bucket (non-fatal):', err);
    });
  },
);

startDispatcher();

export default app;
