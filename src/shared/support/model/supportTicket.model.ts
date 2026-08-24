import { Schema, model, Document, Types } from "mongoose";

export type SupportTicketStatus = "open" | "resolved";

export interface ISupportTicket extends Document {
  userId: Types.ObjectId;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  adminReply?: string;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["open", "resolved"],
      required: true,
      default: "open",
    },
    adminReply: {
      type: String,
      required: false,
    },
  },
  { timestamps: true }
);

export const SupportTicket = model<ISupportTicket>("SupportTicket", supportTicketSchema);
