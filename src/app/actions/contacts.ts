"use server";

import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { normalizeContactName } from "@/lib/contact-name";

export async function createContact(
  organizationId: string,
  formData: FormData
) {
  const org = await getCurrentOrganization();
  if (!org || org.id !== organizationId) {
    return { error: "Organização inválida" };
  }

  const phone = (formData.get("phone") as string)?.replace(/\D/g, "");
  if (!phone || phone.length < 10) {
    return { error: "Telefone inválido" };
  }

  await db.insert(contacts).values({
    organizationId,
    phone: phone.startsWith("55") ? phone : `55${phone}`,
    name: normalizeContactName(formData.get("name") as string),
    email: (formData.get("email") as string) || null,
  });

  return { success: true };
}
