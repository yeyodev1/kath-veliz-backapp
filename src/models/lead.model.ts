import mongoose, { Schema, Types } from "mongoose";

export const LEAD_KINDS = ["free-resource", "waitlist", "newsletter"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export interface ILead {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  source: string;
  product: Types.ObjectId | null;
  kind: LeadKind;
  couponCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const leadSchema = new Schema<ILead>(
  {
    name: { type: String, default: "", trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: "" },
    // Slug de la landing desde donde llegó, o "footer".
    source: { type: String, required: true, trim: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    kind: { type: String, enum: LEAD_KINDS, required: true, index: true },
    couponCode: { type: String, default: "" },
  },
  { timestamps: true },
);

// La misma persona puede dejar su correo en varias landings, pero una vez por cada una.
leadSchema.index({ email: 1, source: 1 }, { unique: true });

export const Lead =
  (mongoose.models.Lead as mongoose.Model<ILead>) || mongoose.model<ILead>("Lead", leadSchema);
