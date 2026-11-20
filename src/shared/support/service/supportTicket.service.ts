import { SupportTicket, ISupportTicket } from "../model/supportTicket.model";
import { AppError } from "../../../utils/AppError";

interface CreateTicketInput {
  subject: string;
  message: string;
}

export const createTicket = async (
  userId: string,
  input: CreateTicketInput
): Promise<ISupportTicket> => {
  if (!input.subject?.trim()) {
    throw new AppError("subject is required", 400);
  }
  if (!input.message?.trim()) {
    throw new AppError("message is required", 400);
  }

  return SupportTicket.create({
    userId,
    subject: input.subject.trim(),
    message: input.message.trim(),
  });
};
