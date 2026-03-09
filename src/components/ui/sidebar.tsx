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
  Package,
  Wrench,
  ShieldCheck,
  UserCog,
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
  isPlanActive = true,
  segment = "mecanica",
  organizations = [],
  activeOrganizationId = null,
}: {
  reservationsEnabled?: boolean;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  isPlanActive?: boolean;
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
    { href: "/dashboard/admin/usuarios", label: "Usuários", icon: UserCog },
  ];
  const lockedNavItems = [
    { href: "/dashboard", label: "Assinar plano", icon: LayoutDashboard },
    { href: "/dashboard/configuracoes", label: "Configurações", icon: Settings },
  ];
  const navItems = [
    ...(isPlatformAdmin
      ? adminNavItems
      : !isPlanActive
        ? lockedNavItems
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
          ...(isAdmin
            ? [{ href: "/dashboard/admin/fluxo", label: "Admin Fluxo", icon: ShieldCheck }]
            : []),
          ...baseNavItems.slice(4),
        ]),
  ];
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-20 flex-col border-r border-[var(--brand-muted)]/20 bg-[var(--brand-soft)]/60 shadow-sm">
      <div className="flex h-16 items-center justify-center border-b border-[var(--brand-muted)]/20 px-2">
        <Link href="/dashboard" className="flex items-center">
          <Image
            src="/icon_mendoza.png"
            alt="Mendoza"
            width={44}
            height={44}
            priority
            className="h-11 w-11 object-contain"
          />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {!isPlatformAdmin && isPlanActive && organizations.length > 1 && (
          <div className="group relative mb-2 flex justify-center">
            <OrganizationSwitcher
              organizations={organizations}
              activeOrganizationId={activeOrganizationId}
              compact
            />
          </div>
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
              aria-label={item.label}
              className={`group relative flex items-center justify-center rounded-xl p-3 transition-all ${
                isActive
                  ? "bg-[var(--brand-primary)] text-white shadow-sm"
                  : "text-[var(--brand-muted)] hover:bg-white hover:text-[var(--brand-deep)]"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--brand-deep)] px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--brand-muted)]/20 p-2">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          aria-label="Sair"
          className="group relative flex w-full items-center justify-center rounded-xl p-3 text-[var(--brand-muted)] transition-colors hover:bg-white hover:text-red-600"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--brand-deep)] px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
            Sair
          </span>
        </button>
      </div>
    </aside>
  );
}
