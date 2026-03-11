import { z } from "zod";

export const signUpSchema = z
  .object({
    name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    email: z.string().email("Email invalido"),
    password: z
      .string()
      .min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string(),
    organizationName: z.string().min(2, "Nome da empresa obrigatorio"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas nao coincidem",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(1, "Senha obrigatoria"),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email("Email invalido"),
});

export const resetPasswordSchema = z
  .object({
    userId: z.string().min(1, "Usuario invalido"),
    token: z.string().min(1, "Token invalido"),
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string().min(1, "Confirme a senha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas nao coincidem",
    path: ["confirmPassword"],
  });

export const updateAccountEmailSchema = z.object({
  newEmail: z.string().email("Email invalido"),
  currentPassword: z.string().min(1, "Senha atual obrigatoria"),
});

export const updateAccountPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Senha atual obrigatoria"),
    newPassword: z.string().min(8, "Nova senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string().min(1, "Confirme a nova senha"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas nao coincidem",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
