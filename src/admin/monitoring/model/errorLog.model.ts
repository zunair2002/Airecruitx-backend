import { Schema, model, Document } from "mongoose";

export interface IErrorLog extends Document {
  message: string;
  statusCode: number;
  path: string;
  method: string;
  createdAt: Date;
}

const errorLogSchema = new Schema<IErrorLog>(
  {
    message: { type: String, required: true },
    statusCode: { type: Number, required: true },
    path: { type: String, required: true },
    method: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ErrorLog = model<IErrorLog>("ErrorLog", errorLogSchema);
