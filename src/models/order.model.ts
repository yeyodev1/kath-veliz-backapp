import mongoose, { Schema, Types } from "mongoose";

export const ORDER_STATUSES = ["pending", "paid", "canceled", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface IOrderItem {
  product: Types.ObjectId;
  title: string;
  priceCents: number;
}

export interface IOrder {
  user: Types.ObjectId;
  items: IOrderItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  coupon: string;
  clientTransactionId: string;
  status: OrderStatus;
  payphoneTransactionId: string;
  payphoneResponse: unknown;
  serviceRequest: Types.ObjectId | null;
  paidAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    // Título y precio se copian: la orden debe contar lo que se cobró aunque el producto cambie.
    title: { type: String, required: true },
    priceCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], default: [] },
    subtotalCents: { type: Number, required: true, min: 0 },
    discountCents: { type: Number, default: 0, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    coupon: { type: String, default: "" },
    // Payphone lo limita a 50 caracteres y lo devuelve en la URL de respuesta.
    clientTransactionId: { type: String, required: true, unique: true, maxlength: 50 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    payphoneTransactionId: { type: String, default: "" },
    // Respuesta completa de Payphone: sirve para soporte y conciliación.
    payphoneResponse: { type: Schema.Types.Mixed, default: null },
    serviceRequest: { type: Schema.Types.ObjectId, ref: "ServiceRequest", default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Order = mongoose.models.Order || mongoose.model<IOrder>("Order", orderSchema);
