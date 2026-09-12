import { z } from "zod";

export const updateSettingsSchema = z.object({
  siteName: z.string().trim().min(1).optional(),
  matchThreshold: z.number().min(0).max(100).optional(),
  allowSignups: z.boolean().optional(),
  maxResumeSizeMB: z.number().positive().optional(),
});
