import http from 'node:http';
import { parseEnv } from '../env.js';

export function startHealthServer(): http.Server {
  const env = parseEnv();

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'editorial-orchestrator' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(env.ORCHESTRATOR_PORT, () => {
    console.log(`Health server listening on port ${env.ORCHESTRATOR_PORT}`);
  });

  server.on('error', (err) => {
    console.error('Health server error:', err);
  });

  return server;
}
