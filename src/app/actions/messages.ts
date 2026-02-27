"use server";

import { revalidatePath } from "next/cache";
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

export async function setConversationAIDisabled(
  conversationId: string,
  hours: number
) {
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

  const until = new Date(Date.now() + hours * 60 * 60 * 1000);

  await db
    .update(conversations)
    .set({ aiDisabledUntil: until, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  return { success: true, aiDisabledUntil: until };
}

export async function setConversationAIEnabled(conversationId: string) {
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

  await db
    .update(conversations)
    .set({
      aiDisabledUntil: null,
      conversationState: "init",
      handoffReason: null,
      handoffAt: null,
      isPriority: false,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  return { success: true };
}

export async function setConversationCarInShop(
  conversationId: string,
  carInShop: boolean
) {
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

  const currentMetadata =
    (conv.conversationStateMetadata as Record<string, unknown> | undefined) ?? {};
  const workshopFlow =
    (currentMetadata.workshopFlow as Record<string, unknown> | undefined) ?? {};

  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    workshopFlow: {
      ...workshopFlow,
      carInShop,
      awaitingVehicleDetails: false,
      updatedAt: new Date().toISOString(),
    },
  };

  await db
    .update(conversations)
    .set({
      conversationStateMetadata: nextMetadata,
      aiDisabledUntil: carInShop ? new Date(Date.now() + 87600 * 60 * 60 * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  return { success: true, carInShop };
}

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

  const threeHoursFromNow = new Date(Date.now() + 3 * 60 * 60 * 1000);

  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: text.slice(0, 100),
      updatedAt: new Date(),
      aiDisabledUntil: threeHoursFromNow, // Humano respondeu: desativa IA por 3h
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
}

export async function resetConversationForTesting(conversationId: string) {
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

  // Apaga o contato para forçar recriação limpa no próximo inbound.
  // Com FK cascade, conversa/mensagens relacionadas também são removidas.
  await db
    .delete(contacts)
    .where(
      and(
        eq(contacts.id, conv.contactId),
        eq(contacts.organizationId, org.id)
      )
    );

  revalidatePath("/dashboard/conversas");
  return { success: true };
}
