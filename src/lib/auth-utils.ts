import { auth } from "@/auth";
import { db } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { cookies } from "next/headers";

export const ACTIVE_ORG_COOKIE = "mendoza_active_org_id";

export async function getCurrentMembership() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const membershipsList = await db
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
    .orderBy(asc(memberships.createdAt))
    ;

  if (membershipsList.length === 0) {
    return null;
  }

  const platformMembership = membershipsList.find(
    (membership) => membership.role === "platform_admin"
  );
  if (platformMembership) {
    return platformMembership;
  }

  const activeOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  if (activeOrgId) {
    const activeMembership = membershipsList.find(
      (membership) => membership.organization.id === activeOrgId
    );
    if (activeMembership) {
      return activeMembership;
    }
  }

  return membershipsList[0] ?? null;
}

export async function getCurrentOrganization() {
  const membership = await getCurrentMembership();
  if (!membership || membership.role === "platform_admin") {
    return null;
  }
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
