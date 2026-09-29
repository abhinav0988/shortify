import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export type UserFields = InferSchemaType<typeof userSchema>;

export interface UserEntity extends UserFields {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const UserModel = model("User", userSchema);

export async function ensureUserIndexes(): Promise<void> {
  await UserModel.init();
}
