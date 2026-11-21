import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as supportTicketService from "../service/supportTicket.service";

const actorOf = (req: Request): supportTicketService.SupportActor => ({
  id: req.user!._id.toString(),
  role: req.user!.role,
  name: req.user!.name,
});

export const createTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const { subject, message } = req.body ?? {};
  const ticket = await supportTicketService.createTicket(actorOf(req), { subject, message });
  res.status(201).json({ success: true, data: ticket });
});

export const listMyTicketsHandler = asyncHandler(async (req: Request, res: Response) => {
  const tickets = await supportTicketService.listMyTickets(actorOf(req));
  res.status(200).json({ success: true, data: tickets });
});

export const getTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await supportTicketService.getTicket(actorOf(req), String(req.params.ticketId));
  res.status(200).json({ success: true, data: ticket });
});

export const postMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body ?? {};
  const ticket = await supportTicketService.postMessage(actorOf(req), String(req.params.ticketId), body);
  res.status(201).json({ success: true, data: ticket });
});
