import { z } from 'zod';

export const WorkerResultPayload = z.object({
  jobId: z.string().uuid(),
  stepId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  resultType: z.string(),
  result: z.record(z.unknown()),
  occurredAt: z.string().datetime().optional(),
});
export type WorkerResultPayload = z.infer<typeof WorkerResultPayload>;
