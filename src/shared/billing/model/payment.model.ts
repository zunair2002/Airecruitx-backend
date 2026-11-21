import { Schema, model, Document, Types } from "mongoose";

export type PaymentKind = "subscription" | "certificate";
export type PaymentStatus = "paid" | "failed";

// One charge shown in the candidate's payment history: a Premium invoice (from Stripe
// Billing) or a certificate purchase (a one-off Checkout payment). Stripe is the source
// of truth; this is a copy for display, upserted by the Stripe id so retries don't duplicate.
export interface IPayment extends Document {
  userId: Types.ObjectId;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  description: string;
  stripeInvoiceId?: string;
  stripeCheckoutSessionId?: string;
  stripeSubscriptionId?: string;
  invoiceNumber?: string;
  periodStart?: Date;
  periodEnd?: Date;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["subscription", "certificate"], required: true },
    status: { type: String, enum: ["paid", "failed"], required: true },
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    description: { type: String, required: true },
    stripeInvoiceId: { type: String },
    stripeCheckoutSessionId: { type: String },
    stripeSubscriptionId: { type: String },
    invoiceNumber: { type: String },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    hostedInvoiceUrl: { type: String },
    invoicePdfUrl: { type: String },
  },
  { timestamps: true }
);

paymentSchema.index({ stripeInvoiceId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ stripeCheckoutSessionId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ userId: 1, createdAt: -1 });

export const Payment = model<IPayment>("Payment", paymentSchema);
