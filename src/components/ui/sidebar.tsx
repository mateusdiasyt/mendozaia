"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { OrganizationSwitcher } from "@/components/ui/organization-switcher";
import {
  MessageSquare,
  Users,
  Zap,
  Settings,
  LogOut,
  MessageCircle,
  LayoutDashboard,
  Calendar,
  Activity,
  Package,
  Wrench,
  ShieldCheck,
} from "lucide-react";

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/conversas", label: "Conversas", icon: MessageSquare },
  { href: "/dashboard/contatos", label: "Contatos", icon: Users },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/dashboard/automacao", label: "Automação", icon: Zap },
  { href: "/dashboard/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar({
  reservationsEnabled = false,
  isAdmin = false,
  isPlatformAdmin = false,
  segment = "mecanica",
  organizations = [],
  activeOrganizationId = null,
}: {
  reservationsEnabled?: boolean;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  segment?: "mecanica" | "restaurante" | "geral";
  organizations?: { id: string; name: string }[];
  activeOrganizationId?: string | null;
}) {
  const servicesLabel =
    segment === "restaurante" ? "Reservas de mesa" : "Serviços";
  const productsLabel = segment === "restaurante" ? "Cardápio" : "Produtos";
  const adminNavItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/admin/fluxo", label: "Admin Fluxo", icon: ShieldCheck },
  ];
  const navItems = [
    ...(isPlatformAdmin
      ? adminNavItems
      : [
          ...baseNavItems.slice(0, 4),
          ...(reservationsEnabled
            ? [
                {
                  href: "/dashboard/reservas",
                  label: "Reservas",
                  icon: Calendar,
                },
                {
                  href: "/dashboard/produtos",
                  label: productsLabel,
                  icon: Package,
                },
                {
                  href: "/dashboard/servicos",
                  label: servicesLabel,
                  icon: Wrench,
                },
              ]
            : []),
          ...(isAdmin ? [{ href: "/dashboard/logs-ia", label: "Logs IA", icon: Activity }] : []),
          ...(isAdmin
            ? [{ href: "/dashboard/admin/fluxo", label: "Admin Fluxo", icon: ShieldCheck }]
            : []),
          ...baseNavItems.slice(4),
        ]),
  ];
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-slate-200 bg-white shadow-sm">
      <div className="flex h-16 items-center justify-center border-b border-slate-100 px-4">
        <Link href="/dashboard" className="flex items-center">
          <Image
            src="/logo_mendoza.png"
            alt="Mendoza - Atendimento com IA"
            width={140}
            height={40}
            priority
            className="h-10 w-auto max-w-[140px] object-contain object-left"
          />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {!isPlatformAdmin && (
          <OrganizationSwitcher
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
          />
        )}
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-600"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-80" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>
      </div>
    </aside>
  );
}
