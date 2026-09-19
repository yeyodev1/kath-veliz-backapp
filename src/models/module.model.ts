import mongoose, { Schema, Types } from "mongoose";

export interface IModule {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  title: string;
  description: string;
  order: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const moduleSchema = new Schema<IModule>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Module =
  (mongoose.models.Module as mongoose.Model<IModule>) ||
  mongoose.model<IModule>("Module", moduleSchema);
