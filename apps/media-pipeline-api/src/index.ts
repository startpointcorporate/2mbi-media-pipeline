import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { parseEnv } from './env.js';
import publicRoutes from './routes/public.js';
import internalRoutes from './routes/internal.js';
import { startDispatcher } from './outbox/dispatcher.js';

const app = new Hono();

app.route('/', publicRoutes);
app.route('/', internalRoutes);

const env = parseEnv();

serve(
  {
    fetch: app.fetch,
    port: env.MEDIA_PIPELINE_PORT,
  },
  (info) => {
    console.log(`Media Pipeline API listening on http://localhost:${info.port}`);
  },
);

startDispatcher();

export default app;
