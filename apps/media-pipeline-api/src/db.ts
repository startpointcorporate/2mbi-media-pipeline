import pg from 'pg';
import { parseEnv } from './env.js';

const pool = new pg.Pool({ connectionString: parseEnv().DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected pool error', err);
});

export const query = pool.query.bind(pool);
export const getClient = pool.connect.bind(pool);
export default pool;
