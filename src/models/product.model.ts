import mongoose, { Schema, Types } from "mongoose";

export const PRODUCT_TYPES = ["course", "download", "service", "free"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const SALE_MODES = ["open", "waitlist", "closed"] as const;
export type SaleMode = (typeof SALE_MODES)[number];

export const SURVEY_QUESTION_TYPES = ["text", "textarea", "select"] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export interface IProductImage {
  url: string;
  publicId: string;
}

export interface IProductFile {
  url: string;
  publicId: string;
  filename: string;
}

export interface IProductFaq {
  question: string;
  answer: string;
}

export interface ISurveyQuestion {
  label: string;
  type: SurveyQuestionType;
  options: string[];
  required: boolean;
}

export interface IProduct {
  _id: Types.ObjectId;
  type: ProductType;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
  audience: string[];
  faqs: IProductFaq[];
  cover: IProductImage | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  saleMode: SaleMode;
  accessDurationDays: number | null;
  isPublished: boolean;
  order: number;
  downloadFile: IProductFile | null;
  freeResourceUrl: string;
  infoPdf: IProductFile | null;
  surveyQuestions: ISurveyQuestion[];
  createdAt?: Date;
  updatedAt?: Date;
}

const imageSchema = new Schema<IProductImage>(
  { url: { type: String, required: true }, publicId: { type: String, default: "" } },
  { _id: false },
);

const fileSchema = new Schema<IProductFile>(
  {
    url: { type: String, default: "" },
    publicId: { type: String, required: true },
    filename: { type: String, default: "" },
  },
  { _id: false },
);

const faqSchema = new Schema<IProductFaq>(
  { question: { type: String, required: true }, answer: { type: String, default: "" } },
  { _id: false },
);

const surveyQuestionSchema = new Schema<ISurveyQuestion>(
  {
    label: { type: String, required: true },
    type: { type: String, enum: SURVEY_QUESTION_TYPES, default: "text" },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

const productSchema = new Schema<IProduct>(
  {
    type: { type: String, enum: PRODUCT_TYPES, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "" },
    description: { type: String, default: "" },
    highlights: { type: [String], default: [] },
    audience: { type: [String], default: [] },
    faqs: { type: [faqSchema], default: [] },
    cover: { type: imageSchema, default: null },
    // Dinero siempre en centavos enteros: nada de decimales flotantes.
    priceCents: { type: Number, default: 0, min: 0 },
    compareAtPriceCents: { type: Number, default: null },
    saleMode: { type: String, enum: SALE_MODES, default: "open" },
    // null = acceso de por vida.
    accessDurationDays: { type: Number, default: null },
    isPublished: { type: Boolean, default: false, index: true },
    order: { type: Number, default: 0 },
    downloadFile: { type: fileSchema, default: null },
    freeResourceUrl: { type: String, default: "" },
    infoPdf: { type: fileSchema, default: null },
    surveyQuestions: { type: [surveyQuestionSchema], default: [] },
  },
  { timestamps: true },
);

export const Product =
  (mongoose.models.Product as mongoose.Model<IProduct>) ||
  mongoose.model<IProduct>("Product", productSchema);
