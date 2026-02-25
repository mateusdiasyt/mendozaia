"use server";

import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { automationRules } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { TriggerType, ConditionType, ActionType } from "@/lib/automation/types";

export interface CreateRuleInput {
  name: string;
  triggerType: TriggerType;
  conditionType: ConditionType;
  conditionValue?: Record<string, unknown>;
  actionType: ActionType;
  actionPayload: Record<string, unknown>;
  priority?: number;
}

export async function createAutomationRule(input: CreateRuleInput) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  await db.insert(automationRules).values({
    organizationId: org.id,
    name: input.name,
    triggerType: input.triggerType,
    conditionType: input.conditionType,
    conditionValue: input.conditionValue ?? {},
    actionType: input.actionType,
    actionPayload: input.actionPayload,
    priority: input.priority ?? 0,
  });

  return { success: true };
}

export async function updateAutomationRule(
  id: string,
  input: Partial<CreateRuleInput>
) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) updates.name = input.name;
  if (input.triggerType !== undefined) updates.triggerType = input.triggerType;
  if (input.conditionType !== undefined)
    updates.conditionType = input.conditionType;
  if (input.conditionValue !== undefined)
    updates.conditionValue = input.conditionValue;
  if (input.actionType !== undefined) updates.actionType = input.actionType;
  if (input.actionPayload !== undefined)
    updates.actionPayload = input.actionPayload;
  if (input.priority !== undefined) updates.priority = input.priority;

  await db
    .update(automationRules)
    .set(updates as typeof automationRules.$inferInsert)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organizationId, org.id)
      )
    );

  return { success: true };
}

export async function toggleAutomationRule(id: string, isActive: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [rule] = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organizationId, org.id)
      )
    )
    .limit(1);

  if (!rule) return { error: "Regra não encontrada" };

  await db
    .update(automationRules)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(automationRules.id, id));

  return { success: true };
}

export async function deleteAutomationRule(id: string) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  await db
    .delete(automationRules)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organizationId, org.id)
      )
    );

  return { success: true };
}
