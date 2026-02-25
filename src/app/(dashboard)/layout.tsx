import { Sidebar } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50/80">
        {children}
      </main>
    </div>
  );
}
