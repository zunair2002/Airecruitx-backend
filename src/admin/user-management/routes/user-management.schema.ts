import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

const ROLES = ["candidate", "hr", "admin"] as const;

export const userIdParamSchema = z.object({
  userId: objectIdParam("userId"),
});

export const setActiveSchema = z.object({
  isActive: z.boolean({ invalid_type_error: "isActive must be a boolean" }),
});

export const setRoleSchema = z.object({
  role: z.enum(ROLES, { errorMap: () => ({ message: `role must be one of: ${ROLES.join(", ")}` }) }),
});
