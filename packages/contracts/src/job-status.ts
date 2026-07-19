import { z } from 'zod';

export const JobStatus = z.enum([
  'pending', 'running', 'completed', 'failed', 'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const StepStatus = z.enum([
  'pending', 'running', 'completed', 'failed', 'skipped',
]);
export type StepStatus = z.infer<typeof StepStatus>;
