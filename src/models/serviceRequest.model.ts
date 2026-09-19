import mongoose, { Schema, Types } from "mongoose";

export const SERVICE_REQUEST_STATUSES = ["pending", "approved", "rejected", "paid"] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export interface IServiceRequestAnswer {
  question: string;
  answer: string;
}

export interface IServiceRequest {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  user: Types.ObjectId | null;
  name: string;
  email: string;
  phone: string;
  answers: IServiceRequestAnswer[];
  status: ServiceRequestStatus;
  adminNote: string;
  order: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const answerSchema = new Schema<IServiceRequestAnswer>(
  { question: { type: String, required: true }, answer: { type: String, default: "" } },
  { _id: false },
);

const serviceRequestSchema = new Schema<IServiceRequest>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: "" },
    answers: { type: [answerSchema], default: [] },
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: "pending", index: true },
    adminNote: { type: String, default: "" },
    order: { type: Schema.Types.ObjectId, ref: "Order", default: null },
  },
  { timestamps: true },
);

export const ServiceRequest =
  (mongoose.models.ServiceRequest as mongoose.Model<IServiceRequest>) ||
  mongoose.model<IServiceRequest>("ServiceRequest", serviceRequestSchema);
