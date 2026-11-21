import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as supportDeskService from "../service/support-desk.service";

export const listSupportTicketsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const tickets = await supportDeskService.listTickets();
  res.status(200).json({ success: true, data: tickets });
});

/** `adminReply` is optional now that tickets are chats; when sent it is posted as an admin message. */
export const resolveSupportTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const { adminReply } = req.body ?? {};
  if (adminReply !== undefined && adminReply !== null && typeof adminReply !== "string") {
    throw new AppError("adminReply must be a string", 400);
  }
  const ticket = await supportDeskService.resolveTicket(
    req.user!._id.toString(),
    String(req.params.ticketId),
    typeof adminReply === "string" ? adminReply : undefined
  );
  res.status(200).json({ success: true, data: ticket });
});

export const reopenSupportTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await supportDeskService.reopenTicket(
    req.user!._id.toString(),
    String(req.params.ticketId)
  );
  res.status(200).json({ success: true, data: ticket });
});
