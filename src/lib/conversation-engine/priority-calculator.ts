/**
 * Cálculo de prioridade para conversas.
 * priorityScore: +2 se cliente já conversou antes, +3 se VIP, +2 se frustração, +1 se conversa longa
 * high_priority se priorityScore >= 5
 */

import type { CustomerProfile } from "@/lib/customer-profile";

export interface PriorityInput {
  hasConversedBefore: boolean;
  vipScore: number;
  frustrationScore: number;
  messageCount: number;
}

export function calculatePriorityScore(input: PriorityInput): number {
  let score = 0;
  if (input.hasConversedBefore) score += 2;
  if (input.vipScore >= 1) score += 3;
  if (input.frustrationScore >= 1) score += 2;
  if (input.messageCount >= 10) score += 1;
  return score;
}

export function isHighPriority(score: number): boolean {
  return score >= 5;
}

export function calculateFromProfile(profile: CustomerProfile | null): {
  priorityScore: number;
  highPriority: boolean;
} {
  const score = calculatePriorityScore({
    hasConversedBefore: (profile?.totalConversations ?? 0) > 0,
    vipScore: profile?.vipScore ?? 0,
    frustrationScore: profile?.frustrationScore ?? 0,
    messageCount: profile?.totalMessages ?? 0,
  });
  return {
    priorityScore: score,
    highPriority: isHighPriority(score),
  };
}
