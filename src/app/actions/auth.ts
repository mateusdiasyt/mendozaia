"use server";

import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { users, organizations, memberships } from "@/lib/db/schema";
import { signUpSchema } from "@/lib/validations/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { AuthError } from "next-auth";

export async function signUp(formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    confirmPassword: formData.get("confirmPassword") as string,
    organizationName: formData.get("organizationName") as string,
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.flatten().fieldErrors,
    };
  }

  const { name, email, password, organizationName } = parsed.data;

  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    return { error: { email: ["Este email já está cadastrado"] } };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      name,
      email,
      passwordHash,
    });

    const slug = `${organizationName.toLowerCase().replace(/\s+/g, "-")}-${nanoid(6)}`;
    const [org] = await tx
      .insert(organizations)
      .values({
        name: organizationName,
        slug,
      })
      .returning();

    if (org) {
      await tx.insert(memberships).values({
        userId,
        organizationId: org.id,
        role: "admin",
      });
    }
  });

  return { success: true };
}

export async function signInAction(formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "Email ou senha inválidos" };
      }
    }
    throw error;
  }
}
