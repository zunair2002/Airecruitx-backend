import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

const ROLES = ["candidate", "hr", "admin"] as const;

export const sendNotificationSchema = z
  .object({
    userId: objectIdParam("userId").optional(),
    role: z.enum(ROLES).optional(),
    message: z.string().trim().min(1, "message is required"),
  })
  .refine((data) => !!data.userId || !!data.role, {
    message: "Either userId or role is required",
    path: ["userId"],
  });
