"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
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
}: {
  reservationsEnabled?: boolean;
}) {
  const navItems = [
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
            label: "Produtos",
            icon: Package,
          },
          {
            href: "/dashboard/servicos",
            label: "Serviços",
            icon: Wrench,
          },
        ]
      : []),
    { href: "/dashboard/logs-ia", label: "Logs IA", icon: Activity },
    ...baseNavItems.slice(4),
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
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>
      </div>
    </aside>
  );
}
