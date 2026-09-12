import { z } from "zod";
import { objectIdParam, dateTimeString } from "../../../middleware/common.schema";

const STATUSES = ["pending", "selected", "rejected"] as const;

export const jobIdParamSchema = z.object({
  jobId: objectIdParam("jobId"),
});

export const applicationIdParamSchema = z.object({
  applicationId: objectIdParam("applicationId"),
});

export const updateStatusSchema = z.object({
  status: z.enum(STATUSES, {
    errorMap: () => ({ message: `status must be one of: ${STATUSES.join(", ")}` }),
  }),
});

export const scheduleAiInterviewSchema = z.object({
  dateTime: dateTimeString("dateTime must be a valid date/time"),
  message: z.string().optional(),
});

export const scheduleOrgInterviewSchema = z.object({
  dateTime: dateTimeString("dateTime must be a valid date/time"),
  location: z.string().optional(),
  notes: z.string().optional(),
});
