import { z } from "zod";

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1, "subject is required"),
  message: z.string().trim().min(1, "message is required"),
});
