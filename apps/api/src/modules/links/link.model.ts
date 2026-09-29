import { Schema, model, Types, type InferSchemaType } from "mongoose";

// expiresAt is stored for the application to enforce later. There is no TTL index:
// MongoDB TTL deletion is asynchronous and would remove the link document, which
// later click history still needs to reference.

const linkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    shortCode: { type: String, required: true },
    originalUrl: { type: String, required: true },
    customAlias: { type: Boolean, required: true, default: false },
    status: { type: String, enum: ["active", "disabled"], required: true, default: "active" },
    expiresAt: { type: Date, default: null },
    totalClicks: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

linkSchema.index({ shortCode: 1 }, { unique: true });
linkSchema.index({ userId: 1, createdAt: -1 });
linkSchema.index({ userId: 1, status: 1, createdAt: -1 });

export type LinkFields = InferSchemaType<typeof linkSchema>;

export interface LinkEntity extends LinkFields {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const LinkModel = model("Link", linkSchema);

export async function ensureLinkIndexes(): Promise<void> {
  await LinkModel.init();
}
