import { z } from "zod";
import { objectIdParam } from "../../../middleware/common.schema";

export const ticketIdParamSchema = z.object({
  ticketId: objectIdParam("ticketId"),
});

export const resolveTicketSchema = z.object({
  adminReply: z.string().trim().min(1, "adminReply is required"),
});
