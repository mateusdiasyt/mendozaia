import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";

export interface ReservationGroupNotificationsConfig {
  enabled: boolean;
  groupId: string | null;
  detectedGroupIds: string[];
  updatedAt?: string;
}

const DEFAULT_CONFIG: ReservationGroupNotificationsConfig = {
  enabled: false,
  groupId: null,
  detectedGroupIds: [],
};

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeGroupId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/\s+/g, "");
  if (!raw) return null;

  if (raw.endsWith("@g.us")) return raw;

  if (raw.includes("@")) return null;

  const cleaned = raw.replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleaned) return null;
  return `${cleaned}@g.us`;
}

export function parseReservationGroupNotifications(
  raw: unknown
): ReservationGroupNotificationsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const input = raw as Record<string, unknown>;
  const groupId = normalizeGroupId(input.groupId);
  const detectedRaw = Array.isArray(input.detectedGroupIds)
    ? input.detectedGroupIds
    : [];
  const detectedGroupIds = uniqueList(
    detectedRaw
      .map((item) => normalizeGroupId(item))
      .filter((item): item is string => Boolean(item))
  );

  if (groupId && !detectedGroupIds.includes(groupId)) {
    detectedGroupIds.unshift(groupId);
  }

  return {
    enabled: input.enabled === true,
    groupId,
    detectedGroupIds: detectedGroupIds.slice(0, 25),
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt.trim().length > 0
        ? input.updatedAt
        : undefined,
  };
}

export async function findBestWhatsappSessionIdForOrg(
  organizationId: string
): Promise<string | null> {
  const [connected] = await db
    .select({ sessionId: whatsappSessions.sessionId })
    .from(whatsappSessions)
    .where(
      and(
        eq(whatsappSessions.organizationId, organizationId),
        eq(whatsappSessions.status, "connected")
      )
    )
    .orderBy(
      desc(whatsappSessions.lastConnectedAt),
      desc(whatsappSessions.updatedAt)
    )
    .limit(1);

  if (connected?.sessionId) return connected.sessionId;

  const [fallback] = await db
    .select({ sessionId: whatsappSessions.sessionId })
    .from(whatsappSessions)
    .where(eq(whatsappSessions.organizationId, organizationId))
    .orderBy(desc(whatsappSessions.updatedAt))
    .limit(1);

  return fallback?.sessionId ?? null;
}

export async function sendTextToWhatsAppGroup(params: {
  sessionId: string;
  groupId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = process.env.WHATSAPP_API_URL;
  if (!apiUrl) return { ok: false, error: "WHATSAPP_API_URL nao configurada" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.EVOLUTION_API_KEY) {
    headers.apikey = process.env.EVOLUTION_API_KEY;
  }

  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/message/sendText/${params.sessionId}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          number: params.groupId,
          text: params.text,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text().catch(() => `Erro ${response.status}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
