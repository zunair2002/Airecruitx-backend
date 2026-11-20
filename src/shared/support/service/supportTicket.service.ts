import { Types } from "mongoose";
import { SupportTicket, ISupportTicket } from "../model/supportTicket.model";
import { Notification } from "../../notification/model/notification.model";
import { User, UserRole } from "../../user/model/user.model";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";

/** Who is acting on a ticket — taken from `req.user`. */
export interface SupportActor {
  id: string;
  role: UserRole;
  name?: string;
}

/**
 * Socket event pushed to the ticket author and every admin whenever a ticket
 * changes. It carries ids only — clients refetch the ticket over REST, where
 * the author-or-admin check is enforced — so no message body travels over the
 * socket rooms (which are joined by user id without authentication).
 */
export const SUPPORT_TICKET_EVENT = "support:ticket";

export type SupportTicketEventKind = "created" | "message" | "status";

export interface SupportTicketEventPayload {
  ticketId: string;
  kind: SupportTicketEventKind;
  status: ISupportTicket["status"];
  actorId: string;
  messageId?: string;
}

export type SupportTicketDTO = Record<string, unknown>;

const MAX_MESSAGE_LENGTH = 5000;

const POPULATE_OWNER = { path: "userId", select: "name email role" };
const POPULATE_AUTHORS = { path: "messages.authorId", select: "name role" };

/** Ticket owner id whether or not `userId` is populated. */
export const ownerIdOf = (ticket: ISupportTicket): string => {
  const owner = ticket.userId as unknown;
  if (owner instanceof Types.ObjectId) return owner.toString();
  return (owner as { _id: Types.ObjectId })._id.toString();
};

/** RBAC: the ticket's author or any admin — everyone else gets 403. */
export const assertCanAccess = (ticket: ISupportTicket, actor: SupportActor): void => {
  if (actor.role === "admin") return;
  if (ownerIdOf(ticket) !== actor.id) {
    throw new AppError("You do not have access to this support ticket", 403);
  }
};

export const findTicketOr404 = async (ticketId: string) => {
  if (!Types.ObjectId.isValid(ticketId)) {
    throw new AppError("Support ticket not found", 404);
  }
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    throw new AppError("Support ticket not found", 404);
  }
  return ticket;
};

/**
 * Persists the thread of a pre-chat ticket (empty `messages`) before a new
 * message is appended: `message` becomes the author's opener and
 * `adminReply` one admin message.
 */
export const materializeLegacyThread = async (ticket: ISupportTicket): Promise<void> => {
  if (ticket.messages.length > 0) return;
  const owner = await User.findById(ticket.userId).select("role");
  ticket.messages.push({
    authorId: ticket.userId,
    authorRole: owner?.role ?? "candidate",
    body: ticket.message,
    createdAt: ticket.createdAt,
  });
  if (ticket.adminReply) {
    ticket.messages.push({
      authorRole: "admin",
      body: ticket.adminReply,
      createdAt: ticket.updatedAt,
    });
  }
};

/**
 * Plain JSON for the API: `userId` and message authors populated, and legacy
 * tickets given a synthesized thread so every ticket reads as a chat.
 */
export const toTicketDTO = (ticket: ISupportTicket): SupportTicketDTO => {
  const obj = ticket.toObject() as SupportTicketDTO & { messages?: unknown[]; userId: unknown };
  if (!obj.messages || obj.messages.length === 0) {
    const owner = obj.userId as { role?: UserRole } | null;
    const role: UserRole = owner && typeof owner === "object" && owner.role ? owner.role : "candidate";
    const thread: Array<Record<string, unknown>> = [
      {
        _id: `${ticket._id}-opener`,
        authorId: obj.userId,
        authorRole: role,
        body: ticket.message,
        createdAt: ticket.createdAt,
      },
    ];
    if (ticket.adminReply) {
      thread.push({
        _id: `${ticket._id}-admin-reply`,
        authorId: null,
        authorRole: "admin",
        body: ticket.adminReply,
        createdAt: ticket.updatedAt,
      });
    }
    obj.messages = thread;
  }
  if (!obj.lastMessageAt) {
    obj.lastMessageAt = ticket.updatedAt;
  }
  return obj;
};

export const loadTicketDTO = async (ticketId: string): Promise<SupportTicketDTO> => {
  const ticket = await SupportTicket.findById(ticketId)
    .populate(POPULATE_OWNER)
    .populate(POPULATE_AUTHORS);
  if (!ticket) {
    throw new AppError("Support ticket not found", 404);
  }
  return toTicketDTO(ticket);
};

/** Every ticket (admin desk), most recently active first. */
export const listAllTicketDTOs = async (): Promise<SupportTicketDTO[]> => {
  const tickets = await SupportTicket.find()
    .populate(POPULATE_OWNER)
    .populate(POPULATE_AUTHORS)
    .sort({ updatedAt: -1 });
  return tickets.map(toTicketDTO);
};

const activeAdminIds = async (): Promise<string[]> => {
  const admins = await User.find({ role: "admin", isActive: true }).select("_id");
  return admins.map((admin) => admin._id.toString());
};

/** Pushes `support:ticket` to the author and every admin (de-duplicated). */
export const emitTicketEvent = async (
  ticket: ISupportTicket,
  payload: Omit<SupportTicketEventPayload, "ticketId" | "status">
): Promise<void> => {
  const recipients = new Set([ownerIdOf(ticket), ...(await activeAdminIds())]);
  const event: SupportTicketEventPayload = {
    ticketId: ticket._id.toString(),
    status: ticket.status,
    ...payload,
  };
  recipients.forEach((userId) => emitToUser(userId, SUPPORT_TICKET_EVENT, event));
};

/** Saves inbox notifications and pushes them live on the existing `admin:notification` event. */
export const notifyUsers = async (userIds: string[], message: string): Promise<void> => {
  await Promise.all(
    userIds.map(async (userId) => {
      const notification = await Notification.create({ userId, message });
      emitToUser(userId, "admin:notification", {
        notificationId: notification._id,
        message: notification.message,
      });
    })
  );
};

const notifyAdmins = async (exceptId: string, message: string): Promise<void> => {
  const adminIds = (await activeAdminIds()).filter((id) => id !== exceptId);
  await notifyUsers(adminIds, message);
};

interface CreateTicketInput {
  subject: unknown;
  message: unknown;
}

export const createTicket = async (
  actor: SupportActor,
  input: CreateTicketInput
): Promise<SupportTicketDTO> => {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!subject) {
    throw new AppError("subject is required", 400);
  }
  if (!message) {
    throw new AppError("message is required", 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(`message must be at most ${MAX_MESSAGE_LENGTH} characters`, 400);
  }

  const now = new Date();
  const ticket = await SupportTicket.create({
    userId: actor.id,
    subject,
    message,
    messages: [{ authorId: actor.id, authorRole: actor.role, body: message, createdAt: now }],
    lastMessageAt: now,
  });

  await notifyAdmins(actor.id, `New support ticket from ${actor.name ?? "a user"}: "${subject}"`);
  await emitTicketEvent(ticket, { kind: "created", actorId: actor.id });

  return loadTicketDTO(ticket._id.toString());
};

/** The signed-in user's own tickets, most recently active first. */
export const listMyTickets = async (actor: SupportActor): Promise<SupportTicketDTO[]> => {
  const tickets = await SupportTicket.find({ userId: actor.id })
    .populate(POPULATE_OWNER)
    .populate(POPULATE_AUTHORS)
    .sort({ updatedAt: -1 });
  return tickets.map(toTicketDTO);
};

/** One ticket with its full thread — author or admin only. */
export const getTicket = async (actor: SupportActor, ticketId: string): Promise<SupportTicketDTO> => {
  const ticket = await findTicketOr404(ticketId);
  assertCanAccess(ticket, actor);
  return loadTicketDTO(ticketId);
};

/**
 * Appends a chat message (author or admin only). A message from the author on
 * a resolved ticket reopens it, so it reappears in the admins' open queue.
 */
export const postMessage = async (
  actor: SupportActor,
  ticketId: string,
  rawBody: unknown
): Promise<SupportTicketDTO> => {
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (!body) {
    throw new AppError("body is required", 400);
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(`body must be at most ${MAX_MESSAGE_LENGTH} characters`, 400);
  }

  const ticket = await findTicketOr404(ticketId);
  assertCanAccess(ticket, actor);

  await materializeLegacyThread(ticket);
  const now = new Date();
  ticket.messages.push({
    authorId: new Types.ObjectId(actor.id),
    authorRole: actor.role,
    body,
    createdAt: now,
  });
  ticket.lastMessageAt = now;

  const isAuthor = ownerIdOf(ticket) === actor.id;
  if (isAuthor && ticket.status === "resolved") {
    ticket.status = "open";
  }
  await ticket.save();

  const messageId = ticket.messages[ticket.messages.length - 1]._id.toString();

  if (isAuthor) {
    await notifyAdmins(
      actor.id,
      `New message on support ticket "${ticket.subject}" from ${actor.name ?? "the author"}`
    );
  } else {
    await notifyUsers([ownerIdOf(ticket)], `An admin replied on your support ticket "${ticket.subject}"`);
  }
  await emitTicketEvent(ticket, { kind: "message", actorId: actor.id, messageId });

  return loadTicketDTO(ticketId);
};
