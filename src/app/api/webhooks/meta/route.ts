import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import {
  CONVERSATION_DEBOUNCE_MS,
  processConversation,
  releaseConversationLock,
  scheduleConversationProcessing,
  tryAcquireConversationLock,
} from "@/lib/conversation-engine/debouncer";

interface MetaMessagePayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
    }>;
  }>;
}

function normalizeMetaContactKey(
  channel: "messenger" | "instagram",
  id: string
): string {
  return `meta:${channel}:${id}`;
}

function detectChannelFromSessionId(
  sessionId: string
): "messenger" | "instagram" | null {
  if (sessionId.startsWith("meta-page-")) return "messenger";
  if (sessionId.startsWith("meta-ig-")) return "instagram";
  return null;
}

function parseMessageContent(
  raw?: {
    text?: string;
    attachments?: Array<{
      type?: string;
      payload?: { url?: string };
    }>;
  }
): {
  contentType: string;
  content: string | null;
  mediaUrl: string | null;
  preview: string;
} {
  const text = raw?.text?.trim() ?? "";
  const attachment = Array.isArray(raw?.attachments) ? raw.attachments[0] : undefined;
  if (!attachment) {
    const preview = text ? text.slice(0, 100) : "[mensagem]";
    return {
      contentType: "text",
      content: text || null,
      mediaUrl: null,
      preview,
    };
  }

  const type = attachment.type?.trim().toLowerCase() || "document";
  const mediaUrl = attachment.payload?.url?.trim() || null;
  const preview = text
    ? `[${type}] ${text}`.slice(0, 100)
    : `[${type}]`;
  return {
    contentType: type,
    content: text || null,
    mediaUrl,
    preview,
  };
}

async function runInlineDebouncedProcessing(
  conversationId: string
): Promise<void> {
  const acquired = await tryAcquireConversationLock(conversationId);
  if (!acquired) return;
  try {
    await new Promise((resolve) => setTimeout(resolve, CONVERSATION_DEBOUNCE_MS));
    await processConversation(conversationId);
  } finally {
    await releaseConversationLock(conversationId);
  }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as MetaMessagePayload;
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    if (entries.length === 0) {
      return NextResponse.json({ ok: true });
    }

    for (const entry of entries) {
      const sourceId = entry.id?.trim();
      if (!sourceId) continue;
      const sessionCandidates = [`meta-page-${sourceId}`, `meta-ig-${sourceId}`];
      const [session] = await db
        .select({
          id: whatsappSessions.id,
          organizationId: whatsappSessions.organizationId,
          sessionId: whatsappSessions.sessionId,
        })
        .from(whatsappSessions)
        .where(inArray(whatsappSessions.sessionId, sessionCandidates))
        .limit(1);
      if (!session) continue;

      const channel = detectChannelFromSessionId(session.sessionId);
      if (!channel) continue;

      const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
      for (const event of messagingEvents) {
        const senderId = event.sender?.id?.trim() ?? "";
        const recipientId = event.recipient?.id?.trim() ?? sourceId;
        const message = event.message;
        const waMessageId = message?.mid?.trim() ?? "";

        if (!senderId || !message || message.is_echo === true) continue;

        const { contentType, content, mediaUrl, preview } = parseMessageContent(message);
        const contactPhone = normalizeMetaContactKey(channel, senderId);

        let [contact] = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.organizationId, session.organizationId),
              eq(contacts.phone, contactPhone)
            )
          )
          .orderBy(asc(contacts.createdAt))
          .limit(1);

        if (!contact) {
          const [inserted] = await db
            .insert(contacts)
            .values({
              organizationId: session.organizationId,
              phone: contactPhone,
              name: channel === "instagram" ? "Instagram" : "Messenger",
            })
            .returning();
          contact = inserted;
        }
        if (!contact) continue;

        let [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, session.organizationId),
              eq(conversations.contactId, contact.id),
              eq(conversations.whatsappSessionId, session.id)
            )
          )
          .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt))
          .limit(1);

        if (!conversation) {
          const [inserted] = await db
            .insert(conversations)
            .values({
              organizationId: session.organizationId,
              contactId: contact.id,
              whatsappSessionId: session.id,
              lastMessageAt: new Date(),
              lastMessagePreview: preview,
            })
            .returning();
          conversation = inserted;
        }
        if (!conversation) continue;

        if (waMessageId) {
          const [existingMessage] = await db
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                eq(messages.waMessageId, waMessageId)
              )
            )
            .limit(1);
          if (existingMessage) continue;
        }

        await db.insert(messages).values({
          conversationId: conversation.id,
          waMessageId: waMessageId || null,
          direction: "inbound",
          contentType,
          content,
          mediaUrl,
          metadata: {
            channel,
            metaSenderId: senderId,
            metaRecipientId: recipientId,
            metaSourceId: sourceId,
          },
        });

        const currentMetadata =
          (conversation.conversationStateMetadata as Record<string, unknown> | undefined) ?? {};
        const nextMetadata: Record<string, unknown> = {
          ...currentMetadata,
          metaRouting: {
            channel,
            userId: senderId,
            businessId: recipientId,
            sourceId,
            updatedAt: new Date().toISOString(),
          },
        };

        await db
          .update(conversations)
          .set({
            lastMessageAt: new Date(),
            lastMessagePreview: preview,
            unreadCount: (conversation.unreadCount ?? 0) + 1,
            conversationStateMetadata: nextMetadata,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversation.id));

        try {
          await scheduleConversationProcessing(conversation.id);
        } catch (scheduleErr) {
          console.warn("[meta webhook] schedule falhou, fallback inline:", scheduleErr);
          await runInlineDebouncedProcessing(conversation.id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[meta webhook] erro:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

