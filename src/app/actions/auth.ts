"use server";

import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import {
  users,
  organizations,
  memberships,
  verificationTokens,
} from "@/lib/db/schema";
import {
  signUpSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateAccountEmailSchema,
  updateAccountPasswordSchema,
  updateAccountNameSchema,
} from "@/lib/validations/auth";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { AuthError } from "next-auth";
import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { sendPasswordResetEmail } from "@/lib/email/resend";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resetIdentifierForUser(userId: string): string {
  return `password_reset:${userId}`;
}

export async function signUp(formData: FormData) {
  try {
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

    const { name, password, organizationName } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    if (!process.env.DATABASE_URL) {
      console.error("[signUp] DATABASE_URL nao configurada");
      return {
        error: {
          _form: ["Erro de configuracao. Verifique as variaveis de ambiente."],
        },
      };
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return { error: { email: ["Este email ja esta cadastrado"] } };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      name,
      email,
      passwordHash,
    });

    const slug = `${organizationName.toLowerCase().replace(/\s+/g, "-")}-${nanoid(6)}`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: organizationName,
        slug,
        plan: "none",
      })
      .returning();

    if (!org) {
      throw new Error("Falha ao criar organizacao");
    }

    await db.insert(memberships).values({
      userId,
      organizationId: org.id,
      role: "admin",
    });

    return { success: true };
  } catch (err) {
    console.error("[signUp] Erro:", err);
    const message = err instanceof Error ? err.message : "Erro ao criar conta";
    return { error: { _form: [message] } };
  }
}

export async function signInAction(formData: FormData) {
  try {
    const email = normalizeEmail((formData.get("email") as string) ?? "");
    await signIn("credentials", {
      email,
      password: formData.get("password") as string,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "Email ou senha invalidos" };
      }
    }
    throw error;
  }
}

export async function requestPasswordResetAction(input: { email: string }) {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Informe um email valido." };
  }

  const email = normalizeEmail(parsed.data.email);

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user?.id || !user.email) {
    return {
      success: true,
      message:
        "Se o email existir, enviaremos um link para redefinir sua senha.",
    };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const identifier = resetIdentifierForUser(user.id);

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));
  await db.insert(verificationTokens).values({
    identifier,
    token: tokenHash,
    expires: expiresAt,
  });

  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetToken: rawToken,
      userId: user.id,
    });
  } catch (error) {
    console.error("[requestPasswordResetAction] failed:", error);
    return {
      error: "Nao foi possivel enviar o email de redefinicao agora.",
    };
  }

  return {
    success: true,
    message: "Enviamos um link de redefinicao para seu email.",
  };
}

export async function resetPasswordWithTokenAction(input: {
  userId: string;
  token: string;
  password: string;
  confirmPassword: string;
}) {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Dados invalidos";
    return { error: first };
  }

  const { userId, token, password } = parsed.data;
  const identifier = resetIdentifierForUser(userId);
  const tokenHash = hashResetToken(token);

  const [stored] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, tokenHash)
      )
    )
    .limit(1);

  if (!stored) {
    return { error: "Link invalido ou ja utilizado." };
  }

  if (stored.expires < new Date()) {
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));
    return { error: "Este link expirou. Solicite um novo." };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));

  return { success: true };
}

export async function updateAccountEmailAction(input: {
  newEmail: string;
  currentPassword: string;
}) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Nao autorizado" };

  const parsed = updateAccountEmailSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Dados invalidos";
    return { error: first };
  }

  const newEmail = normalizeEmail(parsed.data.newEmail);

  const [currentUser] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!currentUser || !currentUser.passwordHash) {
    return { error: "Conta invalida para alteracao." };
  }

  if ((currentUser.email ?? "").toLowerCase() === newEmail) {
    return { error: "Informe um email diferente do atual." };
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    parsed.data.currentPassword,
    currentUser.passwordHash
  );
  if (!isCurrentPasswordValid) {
    return { error: "Senha atual incorreta." };
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, newEmail))
    .limit(1);

  if (existing && existing.id !== currentUser.id) {
    return { error: "Este email ja esta em uso." };
  }

  await db
    .update(users)
    .set({ email: newEmail, updatedAt: new Date() })
    .where(eq(users.id, currentUser.id));

  revalidatePath("/dashboard/configuracoes");
  return {
    success: true,
    message: "Email atualizado. Se necessario, faca novo login para atualizar a sessao.",
  };
}

export async function updateAccountNameAction(input: { name: string }) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Nao autorizado" };

  const parsed = updateAccountNameSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Dados invalidos";
    return { error: first };
  }

  const nextName = parsed.data.name.trim();

  await db
    .update(users)
    .set({
      name: nextName,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  revalidatePath("/dashboard/configuracoes");
  revalidatePath("/dashboard");
  return {
    success: true,
    message: "Nome da conta atualizado com sucesso.",
  };
}

export async function updateAccountPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Nao autorizado" };

  const parsed = updateAccountPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Dados invalidos";
    return { error: first };
  }

  const [currentUser] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!currentUser || !currentUser.passwordHash) {
    return { error: "Conta invalida para alteracao." };
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    parsed.data.currentPassword,
    currentUser.passwordHash
  );
  if (!isCurrentPasswordValid) {
    return { error: "Senha atual incorreta." };
  }

  const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await db
    .update(users)
    .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
    .where(eq(users.id, currentUser.id));

  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, resetIdentifierForUser(currentUser.id)));

  revalidatePath("/dashboard/configuracoes");
  return { success: true, message: "Senha atualizada com sucesso." };
}
