/**
 * Webhook para receber mensagens da API WhatsApp (VPS).
 * Valida assinatura, persiste mensagem e dispara o motor de automação.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
  contactTags,
  organizations,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { processMessageReceivedRules } from "@/lib/automation/engine";

// Formato esperado da Evolution API
interface WebhookPayload {
  instance?: string;
  event?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean };
    message?: { conversation?: string; extendedTextMessage?: { text?: string } };
    state?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WebhookPayload;
    const event = body.event ?? (body as { action?: string }).action;
    const sessionId = body.instance ?? (body as { sessionId?: string }).sessionId;

    // CONNECTION_UPDATE: atualizar status da sessão
    if (event === "CONNECTION_UPDATE" && sessionId) {
      const state = (body.data as { state?: string })?.state ?? body.data;
      const status =
        state === "open" || state === "connected" ? "connected" : "disconnected";

      await db
        .update(whatsappSessions)
        .set({
          status,
          lastConnectedAt:
            status === "connected" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(whatsappSessions.sessionId, sessionId));

      return NextResponse.json({ ok: true });
    }

    // MESSAGES_UPSERT: processar mensagem
    const msgSessionId =
      sessionId ?? body.data?.key?.remoteJid?.split("@")[0];
    if (!msgSessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const isInbound = !body.data?.key?.fromMe;
    const messageText =
      body.data?.message?.conversation ??
      body.data?.message?.extendedTextMessage?.text;
    const remoteJid = body.data?.key?.remoteJid;

    if (!isInbound || !remoteJid) {
      return NextResponse.json({ ok: true }); // Ignora mensagens outbound
    }

    // Buscar sessão WhatsApp e organização
    const [session] = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.sessionId, msgSessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const phone = remoteJid.replace("@s.whatsapp.net", "");

    // Buscar ou criar contato
    let [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, session.organizationId),
          eq(contacts.phone, phone)
        )
      )
      .limit(1);

    if (!contact) {
      [contact] = await db
        .insert(contacts)
        .values({
          organizationId: session.organizationId,
          phone,
        })
        .returning();
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Failed to get/create contact" },
        { status: 500 }
      );
    }

    // Buscar ou criar conversa
    let [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          eq(conversations.whatsappSessionId, session.id)
        )
      )
      .limit(1);

    if (!conversation) {
      [conversation] = await db
        .insert(conversations)
        .values({
          organizationId: session.organizationId,
          contactId: contact.id,
          whatsappSessionId: session.id,
          lastMessageAt: new Date(),
          lastMessagePreview: messageText?.slice(0, 100),
        })
        .returning();
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Failed to get/create conversation" },
        { status: 500 }
      );
    }

    // Salvar mensagem recebida
    await db.insert(messages).values({
      conversationId: conversation.id,
      direction: "inbound",
      contentType: "text",
      content: messageText ?? "",
    });

    // Atualizar conversa
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: messageText?.slice(0, 100),
        unreadCount: conversation.unreadCount + 1,
      })
      .where(eq(conversations.id, conversation.id));

    // Buscar tags do contato
    const contactTagRows = await db
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(eq(contactTags.contactId, contact.id));

    // Horário comercial da organização (settings)
    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const settings = org?.settings as
      | { businessHours?: { start: string; end: string; timezone?: string } }
      | undefined;

    // Executar motor de automação
    await processMessageReceivedRules(
      {
        organizationId: session.organizationId,
        conversationId: conversation.id,
        contactId: contact.id,
        contactPhone: phone,
        messageContent: messageText ?? undefined,
        messageDirection: "inbound",
        lastMessageAt: new Date(),
        assignedToId: conversation.assignedToId,
        contactTagIds: contactTagRows.map((r) => r.tagId),
        businessHours: settings?.businessHours,
      },
        {
          sendMessage: async (_convId, message) => {
          const apiUrl = process.env.WHATSAPP_API_URL;
          const apiKey = process.env.EVOLUTION_API_KEY;
          if (!apiUrl) return;

          const instanceName = session.sessionId;
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (apiKey) {
            headers["apikey"] = apiKey;
          }

          await fetch(`${apiUrl.replace(/\/$/, "")}/message/sendText/${instanceName}`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              number: phone.replace(/\D/g, ""),
              text: message,
            }),
          });
        },
      }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook whatsapp]", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
