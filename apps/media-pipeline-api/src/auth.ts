import crypto from 'node:crypto';
import redis from './redis.js';
import { parseEnv } from './env.js';

interface ClientCredentials {
  tenantId: string;
  apiKey: string;
  apiSecret: string;
}

const MAX_TIMESTAMP_SKEW_MS = 300_000; // 5 minutes
const NONCE_TTL_SECONDS = 600; // 10 minutes

function loadClients(): ClientCredentials[] {
  const raw = parseEnv().CLIENTS_CONFIG;
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((c) => ({
      tenantId: String(c.tenantId || ''),
      apiKey: String(c.apiKey || ''),
      apiSecret: String(c.apiSecret || ''),
    }));
  }

  return [];
}

export async function authenticateRequest(
  tenantIdHeader: string | undefined,
  apiKey: string | undefined,
  apiSecret: string | undefined,
  timestampHeader: string | undefined,
  nonceHeader: string | undefined,
): Promise<string | null> {
  const clients = loadClients();
  if (clients.length === 0) {
    return tenantIdHeader || null;
  }

  if (!apiKey || !apiSecret || !timestampHeader || !nonceHeader) {
    return null;
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    return null;
  }

  const nonceKey = `2mbi:media:auth:nonce:${nonceHeader}`;
  try {
    const existing = await redis.get(nonceKey);
    if (existing) {
      return null; // replay detected
    }
    await redis.set(nonceKey, '1', 'EX', NONCE_TTL_SECONDS);
  } catch {
    // Redis unavailable — log but don't block (degraded mode)
  }

  const client = clients.find((c) => c.apiKey === apiKey);
  if (!client) return null;

  const valid = crypto.timingSafeEqual(
    Buffer.from(client.apiSecret),
    Buffer.from(apiSecret),
  );

  if (!valid) return null;

  // Enforce tenant: if header provided, it MUST match the credential's tenant
  if (tenantIdHeader && tenantIdHeader !== client.tenantId) return null;

  return client.tenantId;
}

export function authenticateInternal(apiKey: string | undefined): boolean {
  const internalKey = parseEnv().INTERNAL_API_KEY;
  if (!internalKey) return true;

  if (!apiKey) return false;

  return crypto.timingSafeEqual(
    Buffer.from(internalKey),
    Buffer.from(apiKey),
  );
}
