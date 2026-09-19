import mongoose, { Schema, Types } from "mongoose";

export interface ICoupon {
  _id: Types.ObjectId;
  code: string;
  percentOff: number;
  product: Types.ObjectId | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, index: true, uppercase: true, trim: true },
    percentOff: { type: Number, required: true, min: 1, max: 100 },
    // null = sirve para cualquier producto.
    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    expiresAt: { type: Date, default: null },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Coupon =
  (mongoose.models.Coupon as mongoose.Model<ICoupon>) ||
  mongoose.model<ICoupon>("Coupon", couponSchema);
