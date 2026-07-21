import { presignedGetUrl } from '../minio.js';
import { parseEnv } from '../env.js';

export interface PrivateMediaAccess {
  url: string;
  expiresAt: string;
  key: string;
  mimeType: string;
}

export interface PublishedMediaAsset {
  assetId: string;
  publicUrl: string;
  privateKey: string;
  mimeType: string;
  fileSize: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  checksum?: string;
  publishedAt: string;
}

export interface MediaDeliveryProvider {
  getPrivateAccessUrl(key: string, mimeType: string): Promise<PrivateMediaAccess>;
  publishAsset(assetId: string, key: string, metadata: {
    fileSize: number;
    mimeType: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    checksum?: string;
  }): Promise<PublishedMediaAsset>;
  unpublishAsset(assetId: string): Promise<void>;
  getPublicUrl(key: string, tenantId: string): string;
}

export class MinioMediaDeliveryProvider implements MediaDeliveryProvider {
  async getPrivateAccessUrl(key: string, mimeType: string): Promise<PrivateMediaAccess> {
    const env = parseEnv();
    const ttl = env.MEDIA_PRIVATE_URL_TTL_SECONDS;
    const url = await presignedGetUrl(key, ttl);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return { url, expiresAt, key, mimeType };
  }

  async publishAsset(assetId: string, key: string, metadata: {
    fileSize: number;
    mimeType: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    checksum?: string;
  }): Promise<PublishedMediaAsset> {
    const env = parseEnv();
    const publicUrl = `${env.MEDIA_PUBLIC_BASE_URL}/${key}`;
    const now = new Date().toISOString();

    return {
      assetId,
      publicUrl,
      privateKey: key,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      checksum: metadata.checksum,
      publishedAt: now,
    };
  }

  async unpublishAsset(_assetId: string): Promise<void> {
    // URLs are virtual - access is controlled by the gateway
    // The database flag is_public=false handles access control
  }

  getPublicUrl(key: string, tenantId: string): string {
    const env = parseEnv();
    return `${env.MEDIA_PUBLIC_BASE_URL}/${tenantId}/${key}`;
  }
}

let _provider: MediaDeliveryProvider | null = null;

export function getMediaDeliveryProvider(): MediaDeliveryProvider {
  if (!_provider) {
    _provider = new MinioMediaDeliveryProvider();
  }
  return _provider;
}
