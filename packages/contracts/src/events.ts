import { z } from 'zod';

export const MediaUploadedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  fileSize: z.number().positive(),
  sourceKey: z.string(),
  sha256: z.string(),
});
export type MediaUploadedData = z.infer<typeof MediaUploadedData>;

export const MediaIngestionCompletedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  normalizedKey: z.string(),
  audioKey: z.string(),
  durationSeconds: z.number().positive(),
  codec: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type MediaIngestionCompletedData = z.infer<typeof MediaIngestionCompletedData>;

export const MediaIngestionFailedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  error: z.string(),
});
export type MediaIngestionFailedData = z.infer<typeof MediaIngestionFailedData>;

export const IngestionRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  sourceKey: z.string(),
});
export type IngestionRequestedData = z.infer<typeof IngestionRequestedData>;
