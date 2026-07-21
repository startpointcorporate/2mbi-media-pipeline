import { z } from 'zod';

export const RetryEntry = z.object({
  command: z.record(z.unknown()),
  step: z.string().min(1),
  attempt: z.number().int().min(0),
  scheduledAt: z.string().datetime(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid().optional(),
});
export type RetryEntry = z.infer<typeof RetryEntry>;

export const DeadLetterMessage = z.object({
  command: z.record(z.unknown()),
  error: z.string().min(1),
  timestamp: z.string().datetime(),
  step: z.string().optional(),
  attempt: z.number().int().optional(),
  correlationId: z.string().uuid().optional(),
  tenantId: z.string().optional(),
});
export type DeadLetterMessage = z.infer<typeof DeadLetterMessage>;

export const BackoffConfig = z.object({
  step: z.string(),
  backoffSeconds: z.array(z.number().positive()),
  maxAttempts: z.number().int().positive().default(3),
});
export type BackoffConfig = z.infer<typeof BackoffConfig>;

export const BusinessError = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  recoverable: z.boolean().default(true),
  retryAfterMs: z.number().positive().optional(),
});
export type BusinessError = z.infer<typeof BusinessError>;

export const ApiErrorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  correlationId: z.string().uuid().optional(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;
