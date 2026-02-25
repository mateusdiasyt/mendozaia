"use server";

import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function sendMessage(conversationId: string, text: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("Organização não encontrada");

  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa não encontrada");

  const [contact] = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, conv.contactId))
    .limit(1);

  const [wsSession] = await db
    .select({ sessionId: whatsappSessions.sessionId })
    .from(whatsappSessions)
    .where(eq(whatsappSessions.id, conv.whatsappSessionId))
    .limit(1);

  if (!contact || !wsSession) throw new Error("Dados da conversa inválidos");

  const apiUrl = process.env.WHATSAPP_API_URL;
  if (!apiUrl) throw new Error("API WhatsApp não configurada");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.EVOLUTION_API_KEY) {
    headers["apikey"] = process.env.EVOLUTION_API_KEY;
  }

  const number = contact.phone.replace(/\D/g, "");
  const instanceName = wsSession.sessionId;

  const res = await fetch(
    `${apiUrl.replace(/\/$/, "")}/message/sendText/${instanceName}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ number, text }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { response?: { message?: string[] }; error?: string })
        ?.response?.message?.[0] ??
        (err as { error?: string })?.error ??
        `Erro ao enviar mensagem (${res.status})`
    );
  }

  await db.insert(messages).values({
    conversationId,
    direction: "outbound",
    contentType: "text",
    content: text,
    status: "sent",
  });

  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: text.slice(0, 100),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}
