import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

const LEVELS = ["beginner", "intermediate", "expert"] as const;

export const startInterviewSchema = z.object({
  level: z.enum(LEVELS, {
    errorMap: () => ({ message: `level must be one of: ${LEVELS.join(", ")}` }),
  }).optional(),
});

export const submitAnswerSchema = z.object({
  sessionId: objectIdParam("sessionId"),
  answer: z.string().min(1, "answer is required"),
});

export const sessionIdParamSchema = z.object({
  sessionId: objectIdParam("sessionId"),
});
