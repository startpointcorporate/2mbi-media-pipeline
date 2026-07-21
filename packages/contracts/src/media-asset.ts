import { z } from 'zod';

export const MediaAssetStatus = z.enum(['pending', 'ingesting', 'ready', 'failed']);
export type MediaAssetStatus = z.infer<typeof MediaAssetStatus>;

export const MediaAsset = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  fileSize: z.number().positive(),
  sourceKey: z.string(),
  sha256: z.string().nullable(),
  normalizedKey: z.string().nullable(),
  audioKey: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  status: MediaAssetStatus,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;
