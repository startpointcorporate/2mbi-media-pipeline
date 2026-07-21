import { z } from 'zod';

export const TargetPlatform = z.enum([
  'instagram',
  'tiktok',
  'youtube_shorts',
  'youtube',
  'facebook',
  'twitter',
  'linkedin',
]);
export type TargetPlatform = z.infer<typeof TargetPlatform>;

export const EditorialClipProposal = z.object({
  startSegmentId: z.number().int().positive(),
  endSegmentId: z.number().int().positive(),
  title: z.string().min(1),
  hook: z.string().min(1),
  reason: z.string(),
  score: z.number().min(0).max(1),
  platforms: z.array(TargetPlatform),
  description: z.string(),
  hashtags: z.array(z.string()),
});
export type EditorialClipProposal = z.infer<typeof EditorialClipProposal>;

export const EditorialAnalysisConstraints = z.object({
  minimumClipDurationSeconds: z.number().positive().default(15),
  maximumClipDurationSeconds: z.number().positive().default(60),
  maximumClipCount: z.number().int().positive().default(3),
});
export type EditorialAnalysisConstraints = z.infer<typeof EditorialAnalysisConstraints>;

export const EditorialAnalysisRequest = z.object({
  mediaId: z.string().uuid(),
  tenantId: z.string().min(1),
  productId: z.string().min(1),
  language: z.string().default('fr'),
  contentType: z.string().optional(),
  editorialGoals: z.string().optional(),
  targetPlatforms: z.array(TargetPlatform),
  constraints: EditorialAnalysisConstraints,
  segments: z.array(
    z.object({
      segmentId: z.number().int().positive(),
      start: z.number().min(0),
      end: z.number().positive(),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
  brandRules: z.string().optional(),
  exclusions: z.array(z.string()).optional(),
});
export type EditorialAnalysisRequest = z.infer<typeof EditorialAnalysisRequest>;

export const EditorialAnalysisResult = z.object({
  summary: z.string(),
  clips: z.array(EditorialClipProposal),
  keywords: z.array(z.string()).optional(),
  sentiment: z.string().optional(),
  categories: z.array(z.string()).optional(),
});
export type EditorialAnalysisResult = z.infer<typeof EditorialAnalysisResult>;

export const EditorialAnalysisRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  transcriptId: z.string().uuid(),
  language: z.string().optional(),
});
export type EditorialAnalysisRequestedData = z.infer<typeof EditorialAnalysisRequestedData>;

export const MediaContentPlanGeneratedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  planId: z.string().uuid(),
  planKey: z.string(),
  clipCount: z.number().int().positive(),
});
export type MediaContentPlanGeneratedData = z.infer<typeof MediaContentPlanGeneratedData>;

export const MediaContentPlanApprovedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  planId: z.string().uuid(),
  approvedClipIds: z.array(z.string().uuid()),
});
export type MediaContentPlanApprovedData = z.infer<typeof MediaContentPlanApprovedData>;

export const EditorialAnalysisFailedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  error: z.string(),
  errorCode: z.string().optional(),
  retryable: z.boolean().default(true),
});
export type EditorialAnalysisFailedData = z.infer<typeof EditorialAnalysisFailedData>;

export const ClipValidationUpdate = z.object({
  clipId: z.string().uuid(),
  action: z.enum(['accept', 'reject', 'modify']),
  title: z.string().optional(),
  hook: z.string().optional(),
  description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  startTime: z.number().positive().optional(),
  endTime: z.number().positive().optional(),
});
export type ClipValidationUpdate = z.infer<typeof ClipValidationUpdate>;

export const YouTubeMetadata = z.object({
  title: z.string().min(1).max(100),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  category: z.string().default('Entertainment'),
  privacyStatus: z.enum(['private', 'unlisted', 'public']).default('unlisted'),
  language: z.string().default('fr'),
});
export type YouTubeMetadata = z.infer<typeof YouTubeMetadata>;

export const MediaPackageStatus = z.enum([
  'pending',
  'generating',
  'ready',
  'downloaded',
  'modified',
  'validated',
  'publishing',
  'published',
  'archived',
  'failed',
]);
export type MediaPackageStatus = z.infer<typeof MediaPackageStatus>;
