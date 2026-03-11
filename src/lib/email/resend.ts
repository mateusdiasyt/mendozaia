import { Resend } from "resend";

function getAppBaseUrl(): string {
  const raw =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY nao configurada.");
  }
  return new Resend(apiKey);
}

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL nao configurado.");
  }
  return from;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name?: string | null;
  resetToken: string;
  userId: string;
}): Promise<void> {
  const resend = getResendClient();
  const from = getFromEmail();
  const baseUrl = getAppBaseUrl();
  const resetUrl =
    `${baseUrl}/redefinir-senha?uid=${encodeURIComponent(params.userId)}` +
    `&token=${encodeURIComponent(params.resetToken)}`;
  const recipientName = params.name?.trim() || "usuario";

  const subject = "Redefinicao de senha";
  const text = [
    `Oi, ${recipientName}!`,
    "",
    "Recebemos um pedido para redefinir sua senha.",
    `Clique no link para criar uma nova senha: ${resetUrl}`,
    "",
    "Este link expira em 30 minutos.",
    "Se voce nao pediu isso, ignore este email.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Redefinicao de senha</h2>
      <p>Oi, ${recipientName}!</p>
      <p>Recebemos um pedido para redefinir sua senha.</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#4f46e5;color:white;text-decoration:none;font-weight:600;">
          Redefinir senha
        </a>
      </p>
      <p>Se preferir, copie e cole este link no navegador:</p>
      <p style="word-break: break-all;">${resetUrl}</p>
      <p>Este link expira em 30 minutos.</p>
      <p>Se voce nao pediu isso, ignore este email.</p>
    </div>
  `;

  await resend.emails.send({
    from,
    to: params.to,
    subject,
    text,
    html,
  });
}
