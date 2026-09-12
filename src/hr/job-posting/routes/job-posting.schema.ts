import { z } from "zod";

export const createJobSchema = z.object({
  title: z.string().trim().min(1, "Job title is required"),
  description: z.string().trim().min(1, "Job description is required"),
  // multipart fields always arrive as strings; a plain-JSON caller may send an array —
  // the controller normalizes either shape into a string[] before calling the service.
  requiredSkills: z.union([z.string(), z.array(z.string())]).optional(),
});
