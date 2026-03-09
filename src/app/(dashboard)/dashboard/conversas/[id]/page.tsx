import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  contactMemories,
  products,
  services,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ChatView } from "./chat-view";
import { AIControlSidebar } from "@/components/conversations/ai-control-sidebar";
import { ContactAvatar } from "@/components/conversations/contact-avatar";
import { ConversationHeaderActions } from "@/components/conversations/conversation-header-actions";
import { ConversationHeaderContact } from "@/components/conversations/conversation-header-contact";

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

  const [recentMessagesDesc, memories, oilProducts, serviceRows] = await Promise.all([
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
    db
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(
        and(eq(services.organizationId, org.id), eq(services.isActive, true))
      ),
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
  const reservationContext =
    (conversationMetadata.reservationContext as Record<string, unknown> | undefined) ?? {};
  const reservationServiceName =
    typeof reservationContext.serviceName === "string"
      ? reservationContext.serviceName
      : null;
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
          <ConversationHeaderContact
            conversationId={id}
            contactName={displayName}
            contactPhone={displayPhone}
          />
        </div>
        <div className="flex items-center gap-1">
          <ConversationHeaderActions conversationId={id} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--brand-surface)]">
          <ChatView conversationId={id} initialMessages={msgList.map((item) => item.message)} />
        </div>
        <AIControlSidebar
          conversationId={id}
          aiDisabledUntil={conv.aiDisabledUntil}
          vehicleModel={vehicleModel}
          vehicleYear={vehicleYear}
          vehicleKm={vehicleKm}
          vehicleOilSpec={vehicleOilSpec}
          reservationDateStr={reservationDateStr}
          reservationTimeStr={reservationTimeStr}
          reservationServiceName={reservationServiceName}
          serviceOptions={serviceRows}
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
