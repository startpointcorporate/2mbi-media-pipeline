import { z } from 'zod';

export const PrivateMediaAccess = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  key: z.string(),
  mimeType: z.string(),
});
export type PrivateMediaAccess = z.infer<typeof PrivateMediaAccess>;

export const PublishedMediaAsset = z.object({
  assetId: z.string().uuid(),
  publicUrl: z.string().url(),
  privateKey: z.string(),
  mimeType: z.string(),
  fileSize: z.number().positive(),
  durationSeconds: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  publishedAt: z.string().datetime(),
});
export type PublishedMediaAsset = z.infer<typeof PublishedMediaAsset>;

export const MediaDeliveryProviderConfig = z.object({
  publicBaseUrl: z.string().url(),
  privateUrlTtlSeconds: z.number().positive().default(900),
});
export type MediaDeliveryProviderConfig = z.infer<typeof MediaDeliveryProviderConfig>;

export const PublicMediaQuery = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
});

export const RangeHeader = z.object({
  start: z.number().min(0),
  end: z.number().optional(),
});
