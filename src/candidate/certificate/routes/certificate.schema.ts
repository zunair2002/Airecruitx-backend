import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

export const sessionIdBodySchema = z.object({
  sessionId: objectIdParam("sessionId"),
});

export const sessionIdParamSchema = z.object({
  sessionId: objectIdParam("sessionId"),
});
