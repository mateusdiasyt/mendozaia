/**
 * Memórias do contato - dados extraídos pela IA para uso em conversas futuras.
 */

import { db } from "@/lib/db";
import { contactMemories, contacts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { normalizeContactName } from "@/lib/contact-name";

function isSafeContactName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/^[a-zà-ú' ]{2,60}$/i.test(trimmed)) return false;
  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (
    [
      "oi",
      "ola",
      "ok",
      "sim",
      "nao",
      "não",
      "quero",
      "valor",
      "preco",
      "troca",
      "oleo",
      "óleo",
      "revisao",
      "revisão",
      "bom dia",
      "boa tarde",
      "boa noite",
    ].includes(normalized)
  ) {
    return false;
  }
  return true;
}

export async function getContactMemories(
  contactId: string
): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: contactMemories.key, value: contactMemories.value })
    .from(contactMemories)
    .where(eq(contactMemories.contactId, contactId));

  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function saveContactMemory(
  contactId: string,
  key: string,
  value: string
): Promise<void> {
  const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalizedKey || !value.trim()) return;

  const trimmed = value.trim().slice(0, 500);
  const [existing] = await db
    .select()
    .from(contactMemories)
    .where(
      and(
        eq(contactMemories.contactId, contactId),
        eq(contactMemories.key, normalizedKey)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(contactMemories)
      .set({ value: trimmed, updatedAt: new Date() })
      .where(eq(contactMemories.id, existing.id));
  } else {
    await db.insert(contactMemories).values({
      contactId,
      key: normalizedKey,
      value: trimmed,
      updatedAt: new Date(),
    });
  }

  // Sincroniza "name" com o campo do contato
  const normalizedContactName = normalizeContactName(trimmed);
  if (
    normalizedKey === "name" &&
    normalizedContactName &&
    isSafeContactName(normalizedContactName)
  ) {
    await db
      .update(contacts)
      .set({
        name: normalizedContactName.slice(0, 255),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
  }
}

export function formatMemoriesForPrompt(memories: Record<string, string>): string {
  if (Object.keys(memories).length === 0) return "";
  const lines = Object.entries(memories).map(
    ([k, v]) => `- ${k}: ${v}`
  );
  return `Informações que você já sabe sobre este cliente:\n${lines.join("\n")}`;
}
