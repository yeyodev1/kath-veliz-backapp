import mongoose, { Schema, Types } from "mongoose";

export interface IProgress {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  product: Types.ObjectId;
  lesson: Types.ObjectId;
  positionSeconds: number;
  completed: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const progressSchema = new Schema<IProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    lesson: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
    positionSeconds: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Un solo registro de avance por alumno y lección.
progressSchema.index({ user: 1, lesson: 1 }, { unique: true });

export const Progress =
  (mongoose.models.Progress as mongoose.Model<IProgress>) ||
  mongoose.model<IProgress>("Progress", progressSchema);
