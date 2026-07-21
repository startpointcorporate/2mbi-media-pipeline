import { z } from 'zod';

export const RenderStrategy = z.enum(['crop', 'contain', 'blur-background', 'center-crop']);
export type RenderStrategy = z.infer<typeof RenderStrategy>;

export const RenderFormat = z.enum(['16:9', '9:16', '1:1']);
export type RenderFormat = z.infer<typeof RenderFormat>;

export const RenderProfile = z.object({
  name: z.string().min(1),
  format: RenderFormat,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  strategy: RenderStrategy,
  codec: z.string().default('h264'),
  audioCodec: z.string().default('aac'),
  faststart: z.boolean().default(true),
  bitrate: z.string().optional(),
  audioBitrate: z.string().optional(),
  fps: z.number().positive().optional(),
  pixelFormat: z.string().default('yuv420p'),
});
export type RenderProfile = z.infer<typeof RenderProfile>;

export const SubtitleStyle = z.object({
  fontName: z.string().default('Arial'),
  fontSize: z.number().positive().default(24),
  fontWeight: z.string().default('bold'),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
  primaryColor: z.string().default('white'),
  outlineColor: z.string().default('black'),
  outlineWidth: z.number().default(2),
  backgroundColor: z.string().optional(),
  maxLines: z.number().int().positive().default(2),
  maxWidth: z.number().positive().default(80),
  bottomMargin: z.number().positive().default(10),
  safeZone: z.number().positive().default(5),
});
export type SubtitleStyle = z.infer<typeof SubtitleStyle>;

export const CaptionProfile = z.object({
  enabled: z.boolean().default(false),
  style: SubtitleStyle,
  formatOverrides: z.record(SubtitleStyle.partial()).optional(),
});
export type CaptionProfile = z.infer<typeof CaptionProfile>;

export const RenderVariantRequest = z.object({
  clipId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  profile: RenderProfile,
  sourceKey: z.string(),
  srtKey: z.string().optional(),
  captionProfile: CaptionProfile.optional(),
  brandProfileId: z.string().uuid().optional(),
  outputPrefix: z.string(),
});
export type RenderVariantRequest = z.infer<typeof RenderVariantRequest>;

export const RenderVideoRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  clipId: z.string().uuid(),
  renderProfile: RenderProfile,
  sourceKey: z.string(),
  srtKey: z.string().optional(),
  captionProfile: CaptionProfile.optional(),
  brandProfileId: z.string().uuid().optional(),
  outputPrefix: z.string(),
});
export type RenderVideoRequestedData = z.infer<typeof RenderVideoRequestedData>;

export const RenderedAsset = z.object({
  assetId: z.string().uuid(),
  format: RenderFormat,
  key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fileSize: z.number().positive(),
  durationMs: z.number().positive().optional(),
  mimeType: z.string().default('video/mp4'),
  hasCaptions: z.boolean().default(false),
  hasBranding: z.boolean().default(false),
  checksum: z.string().optional(),
});
export type RenderedAsset = z.infer<typeof RenderedAsset>;

export const RenderCompletedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  clipId: z.string().uuid(),
  assets: z.array(RenderedAsset),
});
export type RenderCompletedData = z.infer<typeof RenderCompletedData>;

export const RenderFailedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  clipId: z.string().uuid(),
  error: z.string(),
  errorCode: z.string().optional(),
});
export type RenderFailedData = z.infer<typeof RenderFailedData>;

export const ClipGenerationRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  clipId: z.string().uuid(),
  startTime: z.number().min(0),
  endTime: z.number().positive(),
  masterKey: z.string(),
  audioKey: z.string().optional(),
  outputPrefix: z.string(),
});
export type ClipGenerationRequestedData = z.infer<typeof ClipGenerationRequestedData>;

export const ClipGeneratedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  clipId: z.string().uuid(),
  sourceClipKey: z.string(),
  durationSeconds: z.number().positive(),
  fileSize: z.number().positive(),
  checksum: z.string().optional(),
});
export type ClipGeneratedData = z.infer<typeof ClipGeneratedData>;
