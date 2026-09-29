import type { AuthUser } from "@shortify/shared";
import { Types } from "mongoose";
import { HttpError, isDuplicateKeyError } from "../../utils/http-error.js";
import type { LoginBody, RegisterBody } from "./auth.schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { UserModel, type UserEntity } from "./user.model.js";

let dummyPasswordHash: Promise<string> | undefined;

export async function registerUser(input: RegisterBody): Promise<AuthUser> {
  try {
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
    return toAuthUser(user);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new HttpError(409, "Email is already registered");
    }
    throw error;
  }
}

export async function loginUser(input: LoginBody): Promise<AuthUser> {
  const user = await UserModel.findOne({ email: input.email }).select("+passwordHash");
  const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash());
  const passwordMatches = await verifyPassword(passwordHash, input.password);

  if (!user || !passwordMatches) {
    throw new HttpError(401, "Invalid email or password");
  }

  return toAuthUser(user);
}

export async function findAuthUserById(userId: string): Promise<AuthUser | null> {
  if (!Types.ObjectId.isValid(userId)) {
    return null;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    return null;
  }

  return toAuthUser(user);
}

function toAuthUser(user: Pick<UserEntity, "_id" | "name" | "email" | "createdAt">): AuthUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("timing-equalization-placeholder");
  return dummyPasswordHash;
}
