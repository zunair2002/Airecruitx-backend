import { SupportTicket, ISupportTicket } from "../../../shared/support/model/supportTicket.model";
import { Notification } from "../../../shared/notification/model/notification.model";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";
import { logActivity } from "../../activity-log/service/activity-log.service";

export const listTickets = async (): Promise<ISupportTicket[]> => {
  return SupportTicket.find().populate("userId", "name email").sort({ createdAt: -1 });
};

export const resolveTicket = async (
  adminId: string,
  ticketId: string,
  adminReply: string
): Promise<ISupportTicket> => {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    throw new AppError("Support ticket not found", 404);
  }

  ticket.status = "resolved";
  ticket.adminReply = adminReply;
  await ticket.save();

  const notification = await Notification.create({
    userId: ticket.userId,
    message: `Your support ticket "${ticket.subject}" was resolved: ${adminReply}`,
  });
  emitToUser(ticket.userId.toString(), "admin:notification", {
    notificationId: notification._id,
    message: notification.message,
  });

  await logActivity(adminId, "admin", "support.resolve", "SupportTicket", ticketId, { adminReply });

  return ticket;
};
