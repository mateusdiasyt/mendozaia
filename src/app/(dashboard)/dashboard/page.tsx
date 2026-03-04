import { auth } from "@/auth";
import { getCurrentMembership, getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { conversations, contacts, messages } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { PlanPaywall } from "@/components/billing/plan-paywall";
import {
  MessageSquare,
  Users,
  MessageCircle,
  ArrowRight,
  Clock3,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  const membership = await getCurrentMembership();
  const org = await getCurrentOrganization();

  if (membership?.role === "platform_admin") {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">
            Painel Administrativo
          </h1>
          <p className="mt-1 text-slate-500">
            Esta conta possui escopo administrativo da plataforma e não acessa conversas de clientes.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-medium text-slate-900">Acesso disponível</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>• Monitoramento administrativo em `Admin Fluxo`</li>
            <li>• Gestão de configurações globais da plataforma</li>
            <li>• Sem acesso a dados operacionais por organização</li>
          </ul>
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-slate-500">Nenhuma organização encontrada.</p>
      </div>
    );
  }

  if (org.plan === "free" || org.plan === "none") {
    return <PlanPaywall organizationName={org.name} />;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [conversationsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.organizationId, org.id));

  const [contactsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.organizationId, org.id));

  const [startedTodayCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, org.id),
        gte(conversations.createdAt, startOfToday)
      )
    );

  const [inboundTodayCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(messages.direction, "inbound"),
        gte(messages.createdAt, startOfToday)
      )
    );

  const [outboundTodayCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(messages.direction, "outbound"),
        gte(messages.createdAt, startOfToday)
      )
    );

  const [waitingHumanCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, org.id),
        sql`${conversations.conversationState} in ('waiting_human', 'human_active') or ${conversations.isPriority} = true`
      )
    );

  const waitingRows = await db
    .select({
      lastMessageAt: conversations.lastMessageAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, org.id),
        sql`${conversations.conversationState} in ('waiting_human', 'human_active') or ${conversations.isPriority} = true`
      )
    )
    .limit(200);

  const avgQueueMinutes = (() => {
    if (waitingRows.length === 0) return 0;
    const now = Date.now();
    const minutes = waitingRows.map((row) => {
      const baseTime = row.lastMessageAt ?? row.updatedAt ?? startOfToday;
      return Math.max(0, Math.round((now - baseTime.getTime()) / 60000));
    });
    return Math.round(minutes.reduce((acc, cur) => acc + cur, 0) / minutes.length);
  })();

  const serviceRate = (() => {
    const inbound = inboundTodayCount?.count ?? 0;
    const outbound = outboundTodayCount?.count ?? 0;
    if (inbound === 0) return 0;
    return Math.min(100, Math.round((outbound / inbound) * 100));
  })();

  return (
    <div className="p-8">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-slate-900">
          Olá, {session?.user?.name?.split(" ")[0] ?? "usuário"}
        </h1>
        <p className="mt-1 text-slate-500">{org.name}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500">Iniciadas hoje</p>
            <BarChart3 className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{startedTodayCount?.count ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Novas conversas no dia</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500">Mensagens recebidas</p>
            <MessageSquare className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{inboundTodayCount?.count ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Entradas de hoje</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500">Aguardando humano</p>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{waitingHumanCount?.count ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">Fila de atendimento técnico</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500">Tempo médio em fila</p>
            <Clock3 className="h-4 w-4 text-rose-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{avgQueueMinutes} min</p>
          <p className="mt-1 text-xs text-slate-500">Conversas aguardando humano</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-500">Taxa de atendimento</p>
            <TrendingUp className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{serviceRate}%</p>
          <p className="mt-1 text-xs text-slate-500">Saídas x entradas de hoje</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard/conversas"
          className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
            <MessageSquare className="h-5 w-5 text-indigo-600" />
          </div>
          <h3 className="mt-4 font-medium text-slate-900">Conversas</h3>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {conversationsCount?.count ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-500">Caixa de entrada</p>
          <div className="mt-4 flex items-center text-sm font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">
            Ver conversas
            <ArrowRight className="ml-1 h-4 w-4" />
          </div>
        </Link>

        <Link
          href="/dashboard/contatos"
          className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
            <Users className="h-5 w-5 text-indigo-600" />
          </div>
          <h3 className="mt-4 font-medium text-slate-900">Contatos</h3>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {contactsCount?.count ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-500">Total de contatos</p>
          <div className="mt-4 flex items-center text-sm font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">
            Ver contatos
            <ArrowRight className="ml-1 h-4 w-4" />
          </div>
        </Link>

        <Link
          href="/dashboard/whatsapp"
          className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
            <MessageCircle className="h-5 w-5 text-emerald-600" />
          </div>
          <h3 className="mt-4 font-medium text-slate-900">WhatsApp</h3>
          <p className="mt-1 text-sm text-slate-500">Conectar sessão</p>
          <div className="mt-4 flex items-center text-sm font-medium text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100">
            Conectar
            <ArrowRight className="ml-1 h-4 w-4" />
          </div>
        </Link>
      </div>

      <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-medium text-slate-900">Início rápido</h2>
        <ul className="mt-4 space-y-3 text-sm text-slate-600">
          <li className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              1
            </span>
            Conecte seu WhatsApp em &quot;WhatsApp&quot;
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              2
            </span>
            Importe ou adicione contatos
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              3
            </span>
            Configure respostas automáticas em &quot;Automação&quot;
          </li>
        </ul>
      </div>
    </div>
  );
}
