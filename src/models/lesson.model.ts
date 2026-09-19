import mongoose, { Schema, Types } from "mongoose";

export interface ILessonAttachment {
  name: string;
  url: string;
  publicId: string;
}

export interface ILesson {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  module: Types.ObjectId;
  title: string;
  description: string;
  order: number;
  bunnyVideoId: string;
  durationSeconds: number;
  attachments: ILessonAttachment[];
  isFreePreview: boolean;
  isPublished: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const attachmentSchema = new Schema<ILessonAttachment>(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

const lessonSchema = new Schema<ILesson>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    module: { type: Schema.Types.ObjectId, ref: "Module", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    // guid del video en Bunny Stream. Nunca sale en respuestas públicas.
    bunnyVideoId: { type: String, default: "" },
    durationSeconds: { type: Number, default: 0 },
    attachments: { type: [attachmentSchema], default: [] },
    isFreePreview: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Lesson =
  (mongoose.models.Lesson as mongoose.Model<ILesson>) ||
  mongoose.model<ILesson>("Lesson", lessonSchema);
