import { z } from 'zod';

export const SchemaVersion = z.literal(1);
export type SchemaVersion = z.infer<typeof SchemaVersion>;

export const MessageType = z.enum([
  // Commands
  'IngestionRequested',
  'TranscriptionRequested',
  'RenderVideoRequested',
  'RenderImageRequested',
  'EditorialAnalysisRequested',
  'PublishRequested',
  'PublishingStatusCheckRequested',
  // Events
  'MediaUploaded',
  'MediaIngestionCompleted',
  'MediaIngestionFailed',
  'TranscriptionCompleted',
  'TranscriptionFailed',
  'MediaContentPlanGenerated',
  'MediaContentPlanApproved',
  'EditorialAnalysisFailed',
  'RenderCompleted',
  'RenderFailed',
  'ImageGenerationCompleted',
  'ImageGenerationFailed',
  'PublishingSubmitted',
  'PublishingCompleted',
  'PublishingFailed',
  'TranscriptPublished',
  // Internal
  'WorkerResultReceived',
  'HeartbeatReceived',
]);
export type MessageType = z.infer<typeof MessageType>;

export const EventEnvelope = z.object({
  schemaVersion: SchemaVersion,
  messageId: z.string().uuid(),
  messageType: MessageType,
  correlationId: z.string().uuid(),
  causationId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  occurredAt: z.string().datetime(),
  tenantId: z.string().min(1),
  productId: z.string().min(1),
  data: z.record(z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
