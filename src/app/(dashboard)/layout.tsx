import { auth } from "@/auth";
import { getCurrentMembership } from "@/lib/auth-utils";
import { getUserOrganizations } from "@/lib/auth-utils";
import { Sidebar } from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const membership = await getCurrentMembership();
  const org = membership?.organization ?? null;
  const isAdmin = membership?.role === "admin";
  const isPlatformAdmin = membership?.role === "platform_admin";
  const userOrganizations = session?.user?.id
    ? await getUserOrganizations(session.user.id)
    : [];
  const organizationOptions = userOrganizations
    .filter((item) => item.role !== "platform_admin")
    .map((item) => ({
      id: item.organization.id,
      name: item.organization.name,
    }));
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const reservationsEnabled = !!settings.reservationsEnabled;
  const isPlanActive = !org ? false : org.plan !== "free" && org.plan !== "none";
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const segment =
    (botConfig.segment as "mecanica" | "restaurante" | "geral" | undefined) ??
    "mecanica";

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar
        reservationsEnabled={reservationsEnabled}
        isAdmin={isAdmin}
        isPlatformAdmin={isPlatformAdmin}
        isPlanActive={isPlatformAdmin ? true : isPlanActive}
        segment={segment}
        organizations={organizationOptions}
        activeOrganizationId={org?.id ?? null}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50/80">
        {children}
      </main>
    </div>
  );
}
