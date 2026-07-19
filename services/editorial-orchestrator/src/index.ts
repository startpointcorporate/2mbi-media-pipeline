import { parseEnv } from './env.js';
import redis from './redis.js';
import { startOrchestrator } from './orchestrator.js';
import { startHealthServer } from './routes/health.js';

parseEnv();

startHealthServer();

startOrchestrator().catch((err) => {
  console.error('Orchestrator exited:', err);
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
