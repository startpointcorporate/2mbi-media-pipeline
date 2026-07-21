import { parseEnv } from '../env.js';

export interface PublishingProvider {
  preparePublication(request: PreparePublicationRequest): Promise<PreparedPublication>;
  publish(request: PublishRequest): Promise<PublicationResult>;
  getStatus(externalPublicationId: string): Promise<PublicationStatus>;
  cancel(externalPublicationId: string): Promise<void>;
}

export interface PreparePublicationRequest {
  mediaId: string;
  tenantId: string;
  channels: string[];
  title: string;
  description: string;
  hashtags: string[];
  assetUrls: Record<string, string>;
  scheduledAt?: string;
}

export interface PreparedPublication {
  publicationId: string;
  externalId: string;
  channel: string;
  status: string;
  scheduledAt?: string;
  createdAt: string;
}

export interface PublishRequest {
  publicationId: string;
  externalPublicationIds: Array<{ channel: string; externalId: string }>;
}

export interface PublicationResult {
  publicationId: string;
  channel: string;
  externalId: string;
  status: string;
  publicUrl?: string;
  publishedAt?: string;
  error?: string;
}

export interface PublicationStatus {
  externalId: string;
  channel: string;
  status: string;
  publicUrl?: string;
  publishedAt?: string;
  error?: string;
}

export class PostizPublishingProvider implements PublishingProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const env = parseEnv();
    this.baseUrl = env.POSTIZ_BASE_URL.replace(/\/$/, '');
    this.apiKey = env.POSTIZ_API_KEY;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async preparePublication(request: PreparePublicationRequest): Promise<PreparedPublication> {
    if (!this.apiKey) {
      throw new Error('POSTIZ_API_KEY is not configured');
    }

    const channels = request.channels.map((channel) => ({
      channel,
      content: request.description,
      title: request.title,
      hashtags: request.hashtags,
      mediaUrls: request.assetUrls[channel] ? [request.assetUrls[channel]] : [],
    }));

    const response = await fetch(`${this.baseUrl}/api/publications/prepare`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        tenantId: request.tenantId,
        mediaId: request.mediaId,
        channels,
        scheduledAt: request.scheduledAt || null,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Postiz prepare failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const channel = String(data.channel || request.channels[0]);

    return {
      publicationId: request.mediaId,
      externalId: String(data.id || data.externalId || ''),
      channel,
      status: 'draft',
      scheduledAt: request.scheduledAt,
      createdAt: new Date().toISOString(),
    };
  }

  async publish(request: PublishRequest): Promise<PublicationResult> {
    if (!this.apiKey) {
      throw new Error('POSTIZ_API_KEY is not configured');
    }

    const results: PublicationResult[] = [];
    for (const { channel, externalId } of request.externalPublicationIds) {
      try {
        const response = await fetch(`${this.baseUrl}/api/publications/${externalId}/publish`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ channel }),
        });

        if (!response.ok) {
          const text = await response.text();
          results.push({
            publicationId: request.publicationId,
            channel,
            externalId,
            status: 'failed',
            error: `Postiz publish failed (${response.status}): ${text}`,
          });
          continue;
        }

        const data = (await response.json()) as Record<string, unknown>;
        results.push({
          publicationId: request.publicationId,
          channel,
          externalId,
          status: 'published',
          publicUrl: String(data.publicUrl || data.url || ''),
          publishedAt: new Date().toISOString(),
        });
      } catch (err) {
        results.push({
          publicationId: request.publicationId,
          channel,
          externalId,
          status: 'failed',
          error: String(err),
        });
      }
    }

    return results[0] || {
      publicationId: request.publicationId,
      channel: 'unknown',
      externalId: '',
      status: 'failed',
      error: 'No channels to publish',
    };
  }

  async getStatus(externalPublicationId: string): Promise<PublicationStatus> {
    if (!this.apiKey) {
      throw new Error('POSTIZ_API_KEY is not configured');
    }

    const response = await fetch(`${this.baseUrl}/api/publications/${externalPublicationId}/status`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      return {
        externalId: externalPublicationId,
        channel: 'unknown',
        status: 'failed',
        error: `Status check failed (${response.status})`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      externalId: externalPublicationId,
      channel: String(data.channel || 'unknown'),
      status: String(data.status || 'unknown'),
      publicUrl: data.publicUrl ? String(data.publicUrl) : undefined,
      publishedAt: data.publishedAt ? String(data.publishedAt) : undefined,
    };
  }

  async cancel(externalPublicationId: string): Promise<void> {
    if (!this.apiKey) return;

    await fetch(`${this.baseUrl}/api/publications/${externalPublicationId}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }
}
