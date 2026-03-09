import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  contactMemories,
  products,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ChatView } from "./chat-view";
import { AIControlSidebar } from "@/components/conversations/ai-control-sidebar";
import { ContactAvatar } from "@/components/conversations/contact-avatar";

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

export default async function ConversaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const { id } = await params;
  const settings = (org.settings as Record<string, unknown> | undefined) ?? {};
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const segment =
    (botConfig.segment as "mecanica" | "restaurante" | "geral" | undefined) ?? "mecanica";
  const usesVehicleSlots = segment === "mecanica";

  const [conv] = await db
    .select({
      id: conversations.id,
      lastMessagePreview: conversations.lastMessagePreview,
      contactId: conversations.contactId,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
      contactNotes: contacts.notes,
      sessionId: whatsappSessions.sessionId,
      aiDisabledUntil: conversations.aiDisabledUntil,
      conversationState: conversations.conversationState,
      isPriority: conversations.isPriority,
      assignedToId: conversations.assignedToId,
      conversationStateMetadata: conversations.conversationStateMetadata,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(whatsappSessions, eq(conversations.whatsappSessionId, whatsappSessions.id))
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.organizationId, org.id),
        eq(contacts.organizationId, org.id),
        eq(whatsappSessions.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) notFound();

  const [recentMessagesDesc, memories, oilProducts] = await Promise.all([
    db
      .select({ message: messages })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.createdAt))
      .limit(60),
    usesVehicleSlots
      ? db
          .select({ key: contactMemories.key, value: contactMemories.value })
          .from(contactMemories)
          .where(
            and(
              eq(contactMemories.contactId, conv.contactId),
              inArray(contactMemories.key, [
                "vehicle_model",
                "vehicle_year",
                "vehicle_km",
                "vehicle_oil_spec",
              ])
            )
          )
      : Promise.resolve([]),
    usesVehicleSlots
      ? db
          .select({ id: products.id, name: products.name, model: products.model })
          .from(products)
          .where(
            and(
              eq(products.organizationId, org.id),
              eq(products.isActive, true),
              eq(products.category, "oleo")
            )
          )
      : Promise.resolve([]),
  ]);

  const msgList = [...recentMessagesDesc].reverse();

  const memoryByKey = Object.fromEntries(memories.map((m) => [m.key, m.value]));
  const vehicleModel = memoryByKey.vehicle_model ?? null;
  const vehicleYear = memoryByKey.vehicle_year ?? null;
  const vehicleKm = memoryByKey.vehicle_km ?? null;
  const vehicleOilSpec = memoryByKey.vehicle_oil_spec ?? null;
  const conversationMetadata =
    (conv.conversationStateMetadata as Record<string, unknown> | undefined) ?? {};
  const pendingReservation =
    (conversationMetadata.pendingReservation as Record<string, unknown> | undefined) ?? {};
  const reservationPeriodFlow =
    (conversationMetadata.reservationPeriodFlow as Record<string, unknown> | undefined) ?? {};
  const reservationDateStr =
    typeof pendingReservation.dateStr === "string"
      ? pendingReservation.dateStr
      : typeof reservationPeriodFlow.dateStr === "string"
        ? reservationPeriodFlow.dateStr
        : null;
  const reservationTimeStr =
    typeof pendingReservation.timeStr === "string" ? pendingReservation.timeStr : null;
  const workshopFlow =
    (conversationMetadata.workshopFlow as Record<string, unknown> | undefined) as
      | Record<string, unknown>
      | undefined;
  const carInShop = workshopFlow?.carInShop === true;
  const waitingHuman =
    conv.conversationState === "waiting_human" ||
    conv.conversationState === "human_active";
  const inHumanColumn =
    waitingHuman ||
    conv.isPriority === true;

  void db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  const displayName = conv.contactName || conv.contactPhone;
  const displayPhone = formatPhoneNumber(conv.contactPhone);

  return (
    <>
      {/* Header tema claro WhatsApp Web */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] px-4">
        <div className="flex items-center gap-3">
          <ContactAvatar
            sessionId={conv.sessionId}
            phone={conv.contactPhone}
            displayName={displayName}
            size="sm"
            conversationId={id}
          />
          <div>
            <h1 className="font-medium text-[var(--brand-deep)]">
              {displayName}
            </h1>
            <p className="text-xs text-[var(--brand-muted)]">{displayPhone}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
            title="Vide chamada"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
            title="Ligar"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
            title="Buscar"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.9 14.3H15l-.3-.3c1-1.1 1.6-2.7 1.6-4.3 0-3.7-3-6.7-6.7-6.7S3 6 3 9.7s3 6.7 6.7 6.7c1.6 0 3.2-.6 4.3-1.6l.3.3v.8l5.1 5.1 1.5-1.5-5-5.2zm-6.2 0c-2.6 0-4.6-2.1-4.6-4.6s2.1-4.6 4.6-4.6 4.6 2.1 4.6 4.6-2 4.6-4.6 4.6z" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
            title="Menu"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--brand-surface)]">
          <ChatView conversationId={id} initialMessages={msgList.map((item) => item.message)} />
        </div>
        <AIControlSidebar
          conversationId={id}
          aiDisabledUntil={conv.aiDisabledUntil}
          contactName={conv.contactName}
          contactPhone={conv.contactPhone}
          contactEmail={conv.contactEmail}
          contactNotes={conv.contactNotes}
          vehicleModel={vehicleModel}
          vehicleYear={vehicleYear}
          vehicleKm={vehicleKm}
          vehicleOilSpec={vehicleOilSpec}
          reservationDateStr={reservationDateStr}
          reservationTimeStr={reservationTimeStr}
          oilProducts={oilProducts}
          carInShop={carInShop}
          waitingHuman={waitingHuman}
          inHumanColumn={inHumanColumn}
          isPriority={conv.isPriority}
          conversationState={conv.conversationState}
          assignedToId={conv.assignedToId}
          segment={segment}
        />
      </div>
    </>
  );
}
