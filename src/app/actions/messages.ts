"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  contactMemories,
  messages,
  orchestrationLogs,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { saveContactMemory } from "@/lib/contact-memories";
import { learnFromHumanMessage } from "@/lib/ai-training";
import { normalizeContactName } from "@/lib/contact-name";
import { parseMetaChannelsSettings } from "@/lib/meta-channel-settings";
import { sendMetaTextMessage } from "@/lib/meta-api";

type OrchestrationLogMetadata = Record<string, unknown> | null;

function normalizeVehicleModelToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function alignModelToSupportedList(
  rawModel: string,
  supportedModels: string[]
): string | null {
  const rawNormalized = normalizeVehicleModelToken(rawModel);
  if (!rawNormalized) return null;

  const candidates = supportedModels
    .map((model) => ({ original: model.trim(), normalized: normalizeVehicleModelToken(model) }))
    .filter((entry) => entry.original.length > 0 && entry.normalized.length > 0);

  const exact = candidates.find((entry) => entry.normalized === rawNormalized);
  if (exact) return exact.original;

  const words = rawNormalized.split(" ").filter(Boolean);
  const contains = candidates.find((entry) => {
    if (entry.normalized.length < 3) return false;
    if (rawNormalized.includes(entry.normalized)) return true;
    return words.some((word) => word.length >= 3 && entry.normalized.includes(word));
  });
  return contains?.original ?? null;
}

export async function setConversationAIDisabled(
  conversationId: string,
  hours: number
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

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

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

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
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

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

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

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
  revalidatePath("/dashboard/conversas");
  return { success: true };
}

export async function setConversationHumanWaiting(
  conversationId: string,
  waitingHuman: boolean
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

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

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

  await db
    .update(conversations)
    .set({
      conversationState: waitingHuman ? "waiting_human" : "init",
      handoffReason: waitingHuman ? "Encaminhado manualmente para atendimento humano" : null,
      handoffAt: waitingHuman ? new Date() : null,
      isPriority: waitingHuman,
      aiDisabledUntil: waitingHuman ? new Date(Date.now() + 87600 * 60 * 60 * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  revalidatePath("/dashboard/conversas");
  return { success: true, waitingHuman };
}

export async function setConversationCarInShop(
  conversationId: string,
  carInShop: boolean
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

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

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

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

export async function setConversationVehicleOil(
  conversationId: string,
  oilSpec: string | null
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

  const [conv] = await db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

  const value = (oilSpec ?? "").trim();
  if (!value) {
    await db
      .delete(contactMemories)
      .where(
        and(
          eq(contactMemories.contactId, conv.contactId),
          eq(contactMemories.key, "vehicle_oil_spec")
        )
      );
  } else {
    await saveContactMemory(conv.contactId, "vehicle_oil_spec", value);
  }

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  return { success: true, oilSpec: value || null };
}

export async function updateConversationVehicleData(
  conversationId: string,
  data: {
    model?: string | null;
    year?: string | null;
    km?: string | null;
  }
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("Organização não encontrada");

  const [conv] = await db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa não encontrada");

  const cleanModelRaw = (data.model ?? "").trim();
  const cleanYearRaw = (data.year ?? "").trim();
  const cleanKmRaw = (data.km ?? "").trim();
  const orgSettings = (org.settings as Record<string, unknown> | undefined) ?? {};
  const vehiclePolicySettings =
    (orgSettings.vehicleServicePolicy as Record<string, unknown> | undefined) ?? {};
  const supportedModels = Array.isArray(vehiclePolicySettings.supportedModels)
    ? (vehiclePolicySettings.supportedModels as string[]).filter(
        (model) => typeof model === "string" && model.trim().length > 0
      )
    : [];
  const cleanModel =
    cleanModelRaw.length === 0
      ? null
      : (() => {
          const alignedModel = alignModelToSupportedList(cleanModelRaw, supportedModels);
          if (supportedModels.length > 0 && !alignedModel) {
            throw new Error("Modelo não encontrado na tabela de veículos atendidos");
          }
          return alignedModel ?? cleanModelRaw;
        })();

  const cleanYear =
    cleanYearRaw.length === 0
      ? null
      : (() => {
          const parsed = Number.parseInt(cleanYearRaw.replace(/\D+/g, ""), 10);
          if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2035) {
            throw new Error("Ano inválido");
          }
          return String(parsed);
        })();

  const cleanKm =
    cleanKmRaw.length === 0
      ? null
      : (() => {
          const parsed = Number.parseInt(cleanKmRaw.replace(/\D+/g, ""), 10);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error("KM inválido");
          }
          return String(parsed);
        })();

  if (!cleanModel) {
    await db
      .delete(contactMemories)
      .where(
        and(
          eq(contactMemories.contactId, conv.contactId),
          eq(contactMemories.key, "vehicle_model")
        )
      );
  } else {
    await saveContactMemory(conv.contactId, "vehicle_model", cleanModel);
  }

  if (!cleanYear) {
    await db
      .delete(contactMemories)
      .where(
        and(
          eq(contactMemories.contactId, conv.contactId),
          eq(contactMemories.key, "vehicle_year")
        )
      );
  } else {
    await saveContactMemory(conv.contactId, "vehicle_year", cleanYear);
  }

  if (!cleanKm) {
    await db
      .delete(contactMemories)
      .where(
        and(
          eq(contactMemories.contactId, conv.contactId),
          eq(contactMemories.key, "vehicle_km")
        )
      );
  } else {
    await saveContactMemory(conv.contactId, "vehicle_km", cleanKm);
  }

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  revalidatePath("/dashboard/conversas");
  return { success: true };
}

export async function updateConversationContactData(
  conversationId: string,
  data: {
    name?: string | null;
    email?: string | null;
    notes?: string | null;
  }
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

  const [conv] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

  const normalize = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const patch: Partial<typeof contacts.$inferInsert> = {
    updatedAt: new Date(),
  };
  if ("name" in data) {
    patch.name = normalizeContactName(data.name);
  }
  if ("email" in data) {
    patch.email = normalize(data.email);
  }
  if ("notes" in data) {
    patch.notes = normalize(data.notes);
  }

  await db
    .update(contacts)
    .set(patch)
    .where(
      and(eq(contacts.id, conv.contactId), eq(contacts.organizationId, org.id))
    );

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  revalidatePath("/dashboard/conversas");
  return { success: true };
}

export async function updateConversationReservationDraft(
  conversationId: string,
  data: {
    dateStr?: string | null;
    timeStr?: string | null;
    serviceName?: string | null;
  }
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃƒÂ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada");

  const [conv] = await db
    .select({
      id: conversations.id,
      conversationStateMetadata: conversations.conversationStateMetadata,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa nÃƒÂ£o encontrada");

  const normalizeDate = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  };
  const normalizeTime = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
  };

  const dateStr = normalizeDate(data.dateStr);
  const timeStr = normalizeTime(data.timeStr);
  const serviceNameRaw = (data.serviceName ?? "").trim();
  const serviceName = serviceNameRaw.length > 0 ? serviceNameRaw : null;
  const currentMetadata =
    (conv.conversationStateMetadata as Record<string, unknown> | undefined) ?? {};
  const nextMetadata: Record<string, unknown> = { ...currentMetadata };
  const nowIso = new Date().toISOString();

  if (dateStr) {
    const currentPeriodFlow =
      (currentMetadata.reservationPeriodFlow as Record<string, unknown> | undefined) ?? {};
    nextMetadata.reservationPeriodFlow = {
      ...currentPeriodFlow,
      dateStr,
      updatedAt: nowIso,
    };
  } else {
    delete nextMetadata.reservationPeriodFlow;
  }

  if (dateStr && timeStr) {
    const currentPending =
      (currentMetadata.pendingReservation as Record<string, unknown> | undefined) ?? {};
    nextMetadata.pendingReservation = {
      dateStr,
      timeStr,
      durationMinutes:
        typeof currentPending.durationMinutes === "number"
          ? currentPending.durationMinutes
          : 60,
      updatedAt: nowIso,
    };
  } else {
    delete nextMetadata.pendingReservation;
  }

  const currentReservationContext =
    (currentMetadata.reservationContext as Record<string, unknown> | undefined) ?? {};
  if (serviceName) {
    nextMetadata.reservationContext = {
      ...currentReservationContext,
      serviceName,
      updatedAt: nowIso,
    };
  } else if (Object.keys(currentReservationContext).length > 0) {
    const cleanedContext = { ...currentReservationContext };
    delete cleanedContext.serviceName;
    nextMetadata.reservationContext =
      Object.keys(cleanedContext).length > 0
        ? { ...cleanedContext, updatedAt: nowIso }
        : undefined;
    if (!nextMetadata.reservationContext) {
      delete nextMetadata.reservationContext;
    }
  }

  await db
    .update(conversations)
    .set({
      conversationStateMetadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/dashboard/conversas/${conversationId}`);
  return { success: true, dateStr, timeStr, serviceName };
}

export async function getConversationOrchestrationLogs(conversationId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

  const logs = await db
    .select({
      id: orchestrationLogs.id,
      event: orchestrationLogs.event,
      decision: orchestrationLogs.decision,
      reason: orchestrationLogs.reason,
      stateBefore: orchestrationLogs.stateBefore,
      stateAfter: orchestrationLogs.stateAfter,
      metadata: orchestrationLogs.metadata,
      createdAt: orchestrationLogs.createdAt,
    })
    .from(orchestrationLogs)
    .where(
      and(
        eq(orchestrationLogs.organizationId, org.id),
        eq(orchestrationLogs.conversationId, conversationId)
      )
    )
    .orderBy(desc(orchestrationLogs.createdAt))
    .limit(200);

  return logs.map((log) => ({
    id: log.id,
    event: log.event,
    decision: log.decision,
    reason: log.reason,
    stateBefore: log.stateBefore,
    stateAfter: log.stateAfter,
    metadata: (log.metadata as OrchestrationLogMetadata) ?? null,
    createdAt: log.createdAt.toISOString(),
  }));
}

export async function sendMessage(
  conversationId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "Sessao expirada. Recarregue a pagina." };
    }

    const org = await getCurrentOrganization();
    if (!org) {
      return { ok: false, error: "Organizacao nao encontrada." };
    }

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

    if (!conv) {
      return { ok: false, error: "Conversa nao encontrada." };
    }

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

    if (!contact || !wsSession) {
      return { ok: false, error: "Dados da conversa invalidos." };
    }

    const sessionId = wsSession.sessionId;
    const isMetaSession =
      sessionId.startsWith("meta-page-") || sessionId.startsWith("meta-ig-");

    if (isMetaSession) {
      const conversationMetadata =
        (conv.conversationStateMetadata as Record<string, unknown> | undefined) ?? {};
      const metaRouting =
        (conversationMetadata.metaRouting as Record<string, unknown> | undefined) ?? {};

      let channel =
        (metaRouting.channel as "messenger" | "instagram" | undefined) ??
        (sessionId.startsWith("meta-ig-") ? "instagram" : "messenger");
      if (channel !== "messenger" && channel !== "instagram") {
        channel = sessionId.startsWith("meta-ig-") ? "instagram" : "messenger";
      }

      let recipientId =
        typeof metaRouting.userId === "string" ? metaRouting.userId.trim() : "";
      if (!recipientId) {
        const match = contact.phone.match(/^meta:(messenger|instagram):(.+)$/i);
        recipientId = match?.[2]?.trim() ?? "";
      }
      if (!recipientId) {
        return { ok: false, error: "Nao foi possivel identificar o destinatario Meta." };
      }

      const organizationSettings =
        (org.settings as Record<string, unknown> | undefined) ?? {};
      const metaSettings = parseMetaChannelsSettings(organizationSettings.metaChannels);

      let pageConnection =
        channel === "messenger"
          ? metaSettings.channels.find(
              (item) =>
                item.pageId ===
                (typeof metaRouting.pageId === "string"
                  ? metaRouting.pageId.trim()
                  : sessionId.replace("meta-page-", ""))
            )
          : metaSettings.channels.find(
              (item) =>
                item.instagramBusinessAccountId ===
                (typeof metaRouting.businessId === "string"
                  ? metaRouting.businessId.trim()
                  : sessionId.replace("meta-ig-", ""))
            );

      if (!pageConnection && metaSettings.activePageId) {
        pageConnection =
          metaSettings.channels.find((item) => item.pageId === metaSettings.activePageId);
      }
      if (!pageConnection) {
        return {
          ok: false,
          error: "Canal Meta nao conectado. Reconecte Instagram/Messenger em Canais.",
        };
      }

      const businessId =
        typeof metaRouting.businessId === "string" && metaRouting.businessId.trim()
          ? metaRouting.businessId.trim()
          : channel === "instagram"
            ? pageConnection.instagramBusinessAccountId ?? ""
            : pageConnection.pageId;

      if (!businessId) {
        return {
          ok: false,
          error: "Canal Meta sem ID de envio. Verifique a conexao.",
        };
      }

      try {
        await sendMetaTextMessage({
          channel,
          businessId,
          recipientId,
          text,
          pageAccessToken: pageConnection.pageAccessToken,
        });
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Falha ao enviar mensagem para Meta.",
        };
      }
    } else {
      const apiUrl = process.env.WHATSAPP_API_URL;
      if (!apiUrl) {
        return { ok: false, error: "API do WhatsApp nao configurada." };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.EVOLUTION_API_KEY) {
        headers["apikey"] = process.env.EVOLUTION_API_KEY;
      }

      const number = contact.phone.replace(/\D/g, "");
      const res = await fetch(
        `${apiUrl.replace(/\/$/, "")}/message/sendText/${sessionId}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ number, text }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const apiMessage =
          (err as { response?: { message?: string[] }; error?: string })?.response
            ?.message?.[0] ??
          (err as { error?: string })?.error ??
          `Erro ao enviar mensagem (${res.status})`;
        return { ok: false, error: String(apiMessage) };
      }
    }

    await db.insert(messages).values({
      conversationId,
      direction: "outbound",
      contentType: "text",
      content: text,
      status: "sent",
      metadata: isMetaSession
        ? {
            channel: sessionId.startsWith("meta-ig-") ? "instagram" : "messenger",
          }
        : undefined,
    });

    // Nao bloqueia resposta de sucesso se aprendizado/metadados falharem.
    try {
      const [lastInbound] = await db
        .select({ content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, "inbound")
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);

      if (lastInbound?.content?.trim()) {
        await learnFromHumanMessage(
          lastInbound.content.trim(),
          text,
          conv.organizationId
        );
      }
    } catch (learnErr) {
      console.warn("[sendMessage action] learnFromHumanMessage failed", learnErr);
    }

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try {
      await db
        .update(conversations)
        .set({
          lastMessageAt: new Date(),
          lastMessagePreview: text.slice(0, 100),
          updatedAt: new Date(),
          aiDisabledUntil: sevenDaysFromNow,
        })
        .where(eq(conversations.id, conversationId));
    } catch (updateErr) {
      console.warn("[sendMessage action] conversation update failed", updateErr);
    }

    revalidatePath(`/dashboard/conversas/${conversationId}`);
    return { ok: true };
  } catch (error) {
    console.error("[sendMessage action] unexpected error", error);
    return { ok: false, error: "Nao foi possivel enviar agora. Tente novamente." };
  }
}
export async function resetConversationForTesting(conversationId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("NÃ£o autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("OrganizaÃ§Ã£o nÃ£o encontrada");

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

  if (!conv) throw new Error("Conversa nÃ£o encontrada");

  // Apaga o contato para forÃ§ar recriaÃ§Ã£o limpa no prÃ³ximo inbound.
  // Com FK cascade, conversa/mensagens relacionadas tambÃ©m sÃ£o removidas.
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

