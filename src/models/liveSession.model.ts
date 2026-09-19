import mongoose, { Schema, Types } from "mongoose";

export interface ILiveSession {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  title: string;
  description: string;
  startsAt: Date;
  meetUrl: string;
  recordingLesson: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const liveSessionSchema = new Schema<ILiveSession>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    startsAt: { type: Date, required: true, index: true },
    meetUrl: { type: String, default: "" },
    // Cuando la clase ya pasó, apunta a la lección donde quedó la grabación.
    recordingLesson: { type: Schema.Types.ObjectId, ref: "Lesson", default: null },
  },
  { timestamps: true },
);

export const LiveSession =
  (mongoose.models.LiveSession as mongoose.Model<ILiveSession>) ||
  mongoose.model<ILiveSession>("LiveSession", liveSessionSchema);
