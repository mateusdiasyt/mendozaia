/**
 * Motor de automação - avalia regras e executa ações.
 * Modular e preparado para expansão (construtor visual, IA, integrações).
 */

import { db } from "@/lib/db";
import {
  automationRules,
  messages,
  conversations,
  contactTags,
  organizations,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateAIReply, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai-agent";
import type {
  AutomationContext,
  ConditionType,
  ConditionValue,
  ActionType,
  ActionPayload,
} from "./types";
import {
  TRIGGER_TYPES,
  CONDITION_TYPES,
  ACTION_TYPES,
} from "./types";

// ==================== AVALIAÇÃO DE CONDIÇÕES ====================

function evaluateCondition(
  conditionType: ConditionType,
  conditionValue: ConditionValue | null,
  context: AutomationContext
): boolean {
  if (conditionType === CONDITION_TYPES.NONE) {
    return true;
  }

  if (conditionType === CONDITION_TYPES.KEYWORD_CONTAINS) {
    const cfg = conditionValue as { keywords?: string[] };
    const keywords = cfg?.keywords ?? [];
    const content = (context.messageContent ?? "").toLowerCase();
    return keywords.some((kw) => content.includes(kw.toLowerCase()));
  }

  if (conditionType === CONDITION_TYPES.OUTSIDE_BUSINESS_HOURS) {
    const hours = context.businessHours;
    if (!hours) return false;

    const now = new Date();
    const tz = hours.timezone ?? "America/Sao_Paulo";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const current = formatter.format(now);

    return current < hours.start || current > hours.end;
  }

  if (conditionType === CONDITION_TYPES.MINUTES_WITHOUT_REPLY) {
    const cfg = conditionValue as { minutes?: number };
    const minutes = cfg?.minutes ?? 30;
    const lastOutbound = context.lastOutboundAt;
    if (!lastOutbound) return false;

    const diff = (Date.now() - lastOutbound.getTime()) / (1000 * 60);
    return diff >= minutes;
  }

  return false;
}

// ==================== EXECUÇÃO DE AÇÕES ====================

export interface ActionExecutor {
  /** Envia mensagem via API WhatsApp (injetado pelo webhook) */
  sendMessage?: (conversationId: string, message: string) => Promise<void>;
}

async function executeAction(
  actionType: ActionType,
  actionPayload: ActionPayload | null,
  context: AutomationContext,
  executor?: ActionExecutor
): Promise<boolean> {
  let didSendReply = false;

  if (actionType === ACTION_TYPES.REPLY && actionPayload) {
    const msg = (actionPayload as { message?: string }).message;
    if (msg) {
      if (executor?.sendMessage) {
        await executor.sendMessage(context.conversationId, msg);
        didSendReply = true;
      } else {
        await db.insert(messages).values({
          conversationId: context.conversationId,
          direction: "outbound",
          contentType: "text",
          content: msg,
          status: "pending",
        });
        didSendReply = true;
      }
    }
  }

  if (actionType === ACTION_TYPES.AI_REPLY && context.messageContent && executor?.sendMessage) {
    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, context.organizationId))
      .limit(1);

    const aiAgent = (org?.settings as { aiAgent?: { systemPrompt?: string; model?: string; apiKey?: string | null } })?.aiAgent;
    const systemPrompt = aiAgent?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const model = aiAgent?.model || "gemini-2.0-flash";
    const apiKey = aiAgent?.apiKey || undefined;

    try {
      const reply = await generateAIReply(
        context.conversationId,
        context.messageContent,
        systemPrompt,
        model,
        apiKey
      );
      await executor.sendMessage(context.conversationId, reply);
      didSendReply = true;
    } catch (err) {
      console.error("[automation] AI reply failed:", err);
    }
  }

  if (actionType === ACTION_TYPES.ADD_TAG && actionPayload) {
    const tagId = (actionPayload as { tagId?: string }).tagId;
    if (tagId && !context.contactTagIds.includes(tagId)) {
      await db.insert(contactTags).values({
        contactId: context.contactId,
        tagId,
      });
    }
  }

  if (actionType === ACTION_TYPES.ASSIGN_TO_HUMAN) {
    await db
      .update(conversations)
      .set({ assignedToId: null })
      .where(eq(conversations.id, context.conversationId));
  }

  return didSendReply;
}

// ==================== MOTOR PRINCIPAL ====================

/**
 * Processa regras para mensagem recebida (chamado pelo webhook).
 * Retorna true se alguma regra enviou uma resposta.
 */
export async function processMessageReceivedRules(
  context: AutomationContext,
  executor?: ActionExecutor
): Promise<{ didReply: boolean }> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, context.organizationId),
        eq(automationRules.triggerType, TRIGGER_TYPES.MESSAGE_RECEIVED),
        eq(automationRules.isActive, true)
      )
    )
    .orderBy(automationRules.priority);

  let didReply = false;

  for (const rule of rules) {
    const matches = evaluateCondition(
      rule.conditionType as ConditionType,
      rule.conditionValue as ConditionValue,
      context
    );

    if (matches) {
      const sent = await executeAction(
        rule.actionType as ActionType,
        rule.actionPayload as ActionPayload,
        context,
        executor
      );
      if (sent) didReply = true;
    }
  }

  return { didReply };
}

/**
 * Processa regras de follow-up (chamado por cron/worker).
 * Busca conversas sem resposta há X minutos.
 */
export async function processNoReplyTimeoutRules(
  organizationId: string,
  executor?: ActionExecutor
): Promise<void> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, organizationId),
        eq(automationRules.triggerType, TRIGGER_TYPES.NO_REPLY_TIMEOUT),
        eq(automationRules.isActive, true)
      )
    )
    .orderBy(automationRules.priority);

  for (const rule of rules) {
    const cfg = rule.conditionValue as { minutes?: number } | null;
    const minutes = cfg?.minutes ?? 30;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    // Buscar conversas com última mensagem outbound antiga e sem resposta
    const convs = await db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
      })
      .from(conversations)
      .where(eq(conversations.organizationId, organizationId));

    for (const conv of convs) {
      const lastMsg = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      if (lastMsg.length === 0) continue;
      const last = lastMsg[0];
      if (last.direction !== "outbound") continue;
      if (last.createdAt > cutoff) continue;

      const context: AutomationContext = {
        organizationId,
        conversationId: conv.id,
        contactId: conv.contactId,
        contactPhone: "",
        messageDirection: "outbound",
        lastOutboundAt: last.createdAt,
        contactTagIds: [],
      };

      const matches = evaluateCondition(
        rule.conditionType as ConditionType,
        rule.conditionValue as ConditionValue,
        context
      );

      if (matches) {
        await executeAction(
          rule.actionType as ActionType,
          rule.actionPayload as ActionPayload,
          context,
          executor
        );
      }
    }
  }
}
