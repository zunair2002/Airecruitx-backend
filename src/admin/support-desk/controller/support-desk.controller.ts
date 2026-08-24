import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as supportDeskService from "../service/support-desk.service";

export const listSupportTicketsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const tickets = await supportDeskService.listTickets();
  res.status(200).json({ success: true, data: tickets });
});

export const resolveSupportTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const { adminReply } = req.body ?? {};
  if (!adminReply || typeof adminReply !== "string") {
    throw new AppError("adminReply is required", 400);
  }
  const adminId = req.user!._id.toString();
  const ticket = await supportDeskService.resolveTicket(adminId, req.params.ticketId, adminReply);
  res.status(200).json({ success: true, data: ticket });
});
