import { Types } from "mongoose";
import {
  SupportTicketDTO,
  emitTicketEvent,
  findTicketOr404,
  listAllTicketDTOs,
  loadTicketDTO,
  materializeLegacyThread,
  notifyUsers,
  ownerIdOf,
} from "../../../shared/support/service/supportTicket.service";
import { logActivity } from "../../activity-log/service/activity-log.service";

export const listTickets = async (): Promise<SupportTicketDTO[]> => listAllTicketDTOs();

/**
 * Marks a ticket resolved. An optional `adminReply` is appended to the chat
 * as an admin message (and kept in the legacy `adminReply` field).
 */
export const resolveTicket = async (
  adminId: string,
  ticketId: string,
  adminReply?: string
): Promise<SupportTicketDTO> => {
  const ticket = await findTicketOr404(ticketId);
  const reply = adminReply?.trim();

  if (reply) {
    await materializeLegacyThread(ticket);
    const now = new Date();
    ticket.messages.push({
      authorId: new Types.ObjectId(adminId),
      authorRole: "admin",
      body: reply,
      createdAt: now,
    });
    ticket.lastMessageAt = now;
    ticket.adminReply = reply;
  }
  ticket.status = "resolved";
  await ticket.save();

  await notifyUsers(
    [ownerIdOf(ticket)],
    reply
      ? `Your support ticket "${ticket.subject}" was resolved: ${reply}`
      : `Your support ticket "${ticket.subject}" was marked as resolved`
  );
  await emitTicketEvent(ticket, { kind: "status", actorId: adminId });
  await logActivity(adminId, "admin", "support.resolve", "SupportTicket", ticketId, {
    adminReply: reply,
  });

  return loadTicketDTO(ticketId);
};

export const reopenTicket = async (adminId: string, ticketId: string): Promise<SupportTicketDTO> => {
  const ticket = await findTicketOr404(ticketId);
  ticket.status = "open";
  await ticket.save();

  await notifyUsers([ownerIdOf(ticket)], `Your support ticket "${ticket.subject}" was reopened`);
  await emitTicketEvent(ticket, { kind: "status", actorId: adminId });
  await logActivity(adminId, "admin", "support.reopen", "SupportTicket", ticketId);

  return loadTicketDTO(ticketId);
};
