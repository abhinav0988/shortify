import { Schema, model, Types, type InferSchemaType } from "mongoose";

// Click events live in their own collection so a link document stays a bounded
// summary. Analytics queries use this index to filter one link by time.

const clickEventSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "Link", required: true },
    timestamp: { type: Date, required: true },
    country: { type: String, default: null },
    device: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "bot", "unknown"],
      required: true,
    },
    browser: {
      type: String,
      enum: ["chrome", "firefox", "safari", "edge", "other", "unknown"],
      required: true,
    },
    referrer: { type: String, default: null, maxlength: 2048 },
    ipHash: { type: String, default: null },
  },
  { timestamps: false },
);

clickEventSchema.index({ linkId: 1, timestamp: -1 });

export type ClickEventFields = InferSchemaType<typeof clickEventSchema>;

export interface ClickEventEntity extends ClickEventFields {
  _id: Types.ObjectId;
}

export const ClickEventModel = model("ClickEvent", clickEventSchema);

export async function ensureClickIndexes(): Promise<void> {
  await ClickEventModel.init();
}
