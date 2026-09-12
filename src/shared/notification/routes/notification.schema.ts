import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

export const notificationIdParamSchema = z.object({
  id: objectIdParam("id"),
});
