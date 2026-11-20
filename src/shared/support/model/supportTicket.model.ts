import { Schema, model, Document, Types } from "mongoose";
import { UserRole } from "../../user/model/user.model";

export type SupportTicketStatus = "open" | "resolved";

/** One chat message on a ticket. `authorId` is absent only on legacy admin replies. */
export interface ISupportMessage {
  _id: Types.ObjectId;
  authorId?: Types.ObjectId;
  authorRole: UserRole;
  body: string;
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  userId: Types.ObjectId;
  subject: string;
  /** The opening message (kept for older clients; also messages[0] on new tickets). */
  message: string;
  status: SupportTicketStatus;
  /** Legacy single admin reply (pre-chat). Still written when resolving with a reply. */
  adminReply?: string;
  messages: Types.DocumentArray<ISupportMessage>;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const supportMessageSchema = new Schema<ISupportMessage>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    authorRole: { type: String, enum: ["candidate", "hr", "admin"], required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: true }
);

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
    messages: {
      type: [supportMessageSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true }
);

export const SupportTicket = model<ISupportTicket>("SupportTicket", supportTicketSchema);
