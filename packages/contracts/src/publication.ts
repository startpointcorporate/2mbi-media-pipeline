import { z } from 'zod';
import { TargetPlatform } from './editorial.js';

export const PublicationChannel = z.enum([
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'twitter',
  'linkedin',
]);
export type PublicationChannel = z.infer<typeof PublicationChannel>;

export const PublicationStatus = z.enum([
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
]);
export type PublicationStatus = z.infer<typeof PublicationStatus>;

export const PreparePublicationRequest = z.object({
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  channels: z.array(PublicationChannel),
  title: z.string().min(1),
  description: z.string().min(1),
  hashtags: z.array(z.string()),
  assetUrls: z.record(TargetPlatform, z.string().url()),
  scheduledAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type PreparePublicationRequest = z.infer<typeof PreparePublicationRequest>;

export const PreparedPublication = z.object({
  publicationId: z.string().uuid(),
  externalId: z.string(),
  channel: PublicationChannel,
  status: PublicationStatus.default('draft'),
  scheduledAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type PreparedPublication = z.infer<typeof PreparedPublication>;

export const PublishRequest = z.object({
  publicationId: z.string().uuid(),
  externalPublicationIds: z.array(
    z.object({
      channel: PublicationChannel,
      externalId: z.string(),
    }),
  ),
  scheduledAt: z.string().datetime().optional(),
});
export type PublishRequest = z.infer<typeof PublishRequest>;

export const PublicationResult = z.object({
  publicationId: z.string().uuid(),
  channel: PublicationChannel,
  externalId: z.string(),
  status: PublicationStatus,
  publicUrl: z.string().url().optional(),
  publishedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type PublicationResult = z.infer<typeof PublicationResult>;

export const PublicationStatusResult = z.object({
  externalId: z.string(),
  channel: PublicationChannel,
  status: PublicationStatus,
  publicUrl: z.string().url().optional(),
  publishedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type PublicationStatusResult = z.infer<typeof PublicationStatusResult>;

export const PublishingSubmittedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  publicationId: z.string().uuid(),
  externalPublicationIds: z.array(
    z.object({
      channel: PublicationChannel,
      externalId: z.string(),
    }),
  ),
});
export type PublishingSubmittedData = z.infer<typeof PublishingSubmittedData>;

export const PublishingCompletedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  publicationId: z.string().uuid(),
  channel: PublicationChannel,
  externalId: z.string(),
  publicUrl: z.string().url().optional(),
});
export type PublishingCompletedData = z.infer<typeof PublishingCompletedData>;

export const PublishingFailedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  publicationId: z.string().uuid(),
  channel: PublicationChannel,
  externalId: z.string(),
  error: z.string(),
  errorCode: z.string().optional(),
});
export type PublishingFailedData = z.infer<typeof PublishingFailedData>;

export const PublishRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  publicationId: z.string().uuid(),
});
export type PublishRequestedData = z.infer<typeof PublishRequestedData>;

export const PublishingStatusCheckRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  publicationId: z.string().uuid(),
  externalPublicationId: z.string(),
  channel: PublicationChannel,
});
export type PublishingStatusCheckRequestedData = z.infer<typeof PublishingStatusCheckRequestedData>;
