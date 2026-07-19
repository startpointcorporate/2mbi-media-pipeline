import { z } from 'zod';

export const HeartbeatPayload = z.object({
  workerId: z.string().min(1),
  progress: z.number().min(0).max(100),
  leaseDurationSeconds: z.number().positive(),
  occurredAt: z.string().datetime().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayload>;
