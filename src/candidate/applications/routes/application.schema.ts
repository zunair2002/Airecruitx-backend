import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

export const jobIdParamSchema = z.object({
  jobId: objectIdParam("jobId"),
});
