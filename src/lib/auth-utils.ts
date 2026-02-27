import { auth } from "@/auth";
import { db } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function getCurrentMembership() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [membership] = await db
    .select({
      organization: organizations,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(organizations.status, "active")
      )
    )
    .limit(1);

  return membership ?? null;
}

export async function getCurrentOrganization() {
  const membership = await getCurrentMembership();
  return membership?.organization ?? null;
}

export async function getUserOrganizations(userId: string) {
  return db
    .select({
      organization: organizations,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId));
}
