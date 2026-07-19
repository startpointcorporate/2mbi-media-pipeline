import { Redis } from 'ioredis';
import { parseEnv } from './env.js';

const redis = new Redis(parseEnv().REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error('Redis error', err);
});

export default redis;
