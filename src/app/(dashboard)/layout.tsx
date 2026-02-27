import { getCurrentMembership } from "@/lib/auth-utils";
import { Sidebar } from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await getCurrentMembership();
  const org = membership?.organization ?? null;
  const isAdmin = membership?.role === "admin";
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const reservationsEnabled = !!settings.reservationsEnabled;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar reservationsEnabled={reservationsEnabled} isAdmin={isAdmin} />
      <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50/80">
        {children}
      </main>
    </div>
  );
}
