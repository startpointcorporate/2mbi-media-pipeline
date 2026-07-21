import crypto from 'node:crypto';
import { parseEnv } from './env.js';

interface ClientCredentials {
  tenantId: string;
  apiKey: string;
  apiSecret: string;
}

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

export function authenticateRequest(
  tenantId: string | undefined,
  apiKey: string | undefined,
  apiSecret: string | undefined,
): string | null {
  const clients = loadClients();
  if (clients.length === 0) {
    return tenantId || null;
  }

  const client = clients.find((c) => c.apiKey === apiKey);
  if (!client) return null;

  const valid = crypto.timingSafeEqual(
    Buffer.from(client.apiSecret),
    Buffer.from(apiSecret || ''),
  );

  if (!valid) return null;

  if (tenantId && tenantId !== client.tenantId) return null;

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
