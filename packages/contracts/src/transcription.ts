import { z } from 'zod';

export const TranscriptionSegment = z.object({
  segmentId: z.number().int().positive(),
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string(),
  speaker: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number().min(0),
        end: z.number().positive(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
});
export type TranscriptionSegment = z.infer<typeof TranscriptionSegment>;

export const TranscriptionData = z.object({
  mediaId: z.string().uuid(),
  language: z.string().default('fr'),
  durationSeconds: z.number().positive(),
  text: z.string(),
  segments: z.array(TranscriptionSegment),
  wordCount: z.number().int().positive().optional(),
});
export type TranscriptionData = z.infer<typeof TranscriptionData>;

export const TranscriptionCompletedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  transcriptId: z.string().uuid(),
  transcriptKey: z.string(),
  srtKey: z.string(),
  vttKey: z.string(),
  language: z.string(),
  segmentCount: z.number().int().positive(),
  durationSeconds: z.number().positive(),
});
export type TranscriptionCompletedData = z.infer<typeof TranscriptionCompletedData>;

export const TranscriptionFailedData = z.object({
  mediaId: z.string().uuid(),
  jobId: z.string().uuid(),
  error: z.string(),
  errorCode: z.string().optional(),
});
export type TranscriptionFailedData = z.infer<typeof TranscriptionFailedData>;

export const TranscriptionRequestedData = z.object({
  jobId: z.string().uuid(),
  mediaId: z.string().uuid(),
  tenantId: z.string(),
  productId: z.string(),
  audioKey: z.string(),
  language: z.string().optional(),
});
export type TranscriptionRequestedData = z.infer<typeof TranscriptionRequestedData>;

export const SrtSubtitle = z.object({
  index: z.number().int().positive(),
  start: z.string(),
  end: z.string(),
  text: z.string(),
});
export type SrtSubtitle = z.infer<typeof SrtSubtitle>;

export const VttSubtitle = z.object({
  start: z.string(),
  end: z.string(),
  text: z.string(),
});
export type VttSubtitle = z.infer<typeof VttSubtitle>;
