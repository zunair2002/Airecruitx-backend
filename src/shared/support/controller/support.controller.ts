import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as supportTicketService from "../service/supportTicket.service";

export const createTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { subject, message } = req.body ?? {};
  const ticket = await supportTicketService.createTicket(userId, { subject, message });
  res.status(201).json({ success: true, data: ticket });
});
