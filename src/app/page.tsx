import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AnimatedWhatsappSim } from "@/components/landing/animated-whatsapp-sim";
import {
  Wrench,
  UtensilsCrossed,
  Stethoscope,
  Smile,
  Sparkles,
  Dumbbell,
  Building2,
  CarFront,
  Laptop2,
  GraduationCap,
} from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  const niches = [
    {
      label: "Oficinas mecânicas",
      subtitle: "Triagem técnica e agendamentos",
      icon: Wrench,
      accent: "from-indigo-100 to-indigo-50 text-indigo-700",
    },
    {
      label: "Restaurantes",
      subtitle: "Reservas e confirmação automática",
      icon: UtensilsCrossed,
      accent: "from-emerald-100 to-emerald-50 text-emerald-700",
    },
    {
      label: "Clínicas e consultórios",
      subtitle: "Agenda e lembretes de atendimento",
      icon: Stethoscope,
      accent: "from-cyan-100 to-cyan-50 text-cyan-700",
    },
    {
      label: "Odontologia",
      subtitle: "Pré-triagem e retorno de pacientes",
      icon: Smile,
      accent: "from-sky-100 to-sky-50 text-sky-700",
    },
    {
      label: "Estética e beleza",
      subtitle: "Captação e recorrência de clientes",
      icon: Sparkles,
      accent: "from-pink-100 to-pink-50 text-pink-700",
    },
    {
      label: "Academias",
      subtitle: "Follow-up de leads e planos",
      icon: Dumbbell,
      accent: "from-orange-100 to-orange-50 text-orange-700",
    },
    {
      label: "Imobiliárias",
      subtitle: "Qualificação e distribuição de leads",
      icon: Building2,
      accent: "from-violet-100 to-violet-50 text-violet-700",
    },
    {
      label: "Autoescolas",
      subtitle: "Atendimento e matrículas",
      icon: CarFront,
      accent: "from-amber-100 to-amber-50 text-amber-700",
    },
    {
      label: "Assistência técnica",
      subtitle: "Diagnóstico e status de serviço",
      icon: Laptop2,
      accent: "from-teal-100 to-teal-50 text-teal-700",
    },
    {
      label: "Educação e cursos",
      subtitle: "Conversão de interesse em matrícula",
      icon: GraduationCap,
      accent: "from-fuchsia-100 to-fuchsia-50 text-fuchsia-700",
    },
  ] as const;

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Image
              src="/logo_mendoza.png"
              alt="Mendoza IA"
              width={140}
              height={40}
              className="h-9 w-auto"
              priority
            />
          </div>
          <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
            <a href="#interface" className="hover:text-slate-900">
              Interface
            </a>
            <a href="#como-funciona" className="hover:text-slate-900">
              Como funciona
            </a>
            <a href="#nichos" className="hover:text-slate-900">
              Nichos
            </a>
            <a href="#planos" className="hover:text-slate-900">
              Planos
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Entrar
            </Link>
            <Link
              href="/registro"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Cadastrar-se
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-14">
        <div className="grid items-center gap-8">
          <div>
            <p className="inline-flex rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
              CRM + Automação WhatsApp + IA
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              Venda mais no WhatsApp com atendimento inteligente para múltiplos nichos
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              A Mendoza IA centraliza conversas, automação e handoff humano em
              um só lugar. Você configura por segmento e escala seu atendimento
              com qualidade.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/registro"
                className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500"
              >
                Começar agora
              </Link>
              <a
                href="#planos"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 hover:bg-slate-100"
              >
                Ver planos
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="interface" className="scroll-mt-28 border-y border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold">Interface</h2>
          <p className="mt-2 text-slate-600">
            Visualização completa da experiência: conversa simulada + painel de
            estado da IA atualizado em tempo real. Dados fictícios, sem
            confirmação real de reserva.
          </p>
          <div className="mt-6">
            <AnimatedWhatsappSim variant="full" />
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-28 border-y border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold">Como funciona</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-1">
              {[
                ["1. Conecte o WhatsApp", "Conecte seu número diretamente no nosso painel em minutos."],
                ["2. Configure seu nicho", "Escolha segmento, tom e regras do atendimento."],
                ["3. Ative automações", "Fluxos inteligentes para orçamento, agendamento e triagem."],
                ["4. Escale com controle", "IA responde, humano assume casos técnicos quando necessário."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-900">{title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{desc}</p>
                </div>
              ))}
            </div>

            <div className="lg:col-span-2">
              <AnimatedWhatsappSim variant="compact" />
            </div>
          </div>
        </div>
      </section>

      <section id="nichos" className="scroll-mt-28 mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-3xl font-bold">Segmentos com alta demanda</h2>
        <p className="mt-2 text-slate-600">
          A plataforma foi pensada para diferentes operações e pode ser adaptada
          por nicho.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {niches.map((niche) => {
            const Icon = niche.icon;
            return (
              <article
                key={niche.label}
                className="group rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`rounded-lg bg-gradient-to-br p-2 ${niche.accent}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-800">
                      {niche.label}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {niche.subtitle}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="planos" className="scroll-mt-28 border-y border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold">Planos e valores</h2>
          <p className="mt-2 text-slate-600">
            Modelo acessível para crescimento com margem: assinatura + franquia de conversas.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 p-6">
              <h3 className="text-lg font-semibold">Starter</h3>
              <p className="mt-2 text-3xl font-bold">R$ 299/mês</p>
              <p className="mt-1 text-sm text-slate-500">até 1.000 conversas/mês</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li>- 1 número WhatsApp</li>
                <li>- IA + automação + CRM</li>
                <li>- Handoff humano técnico</li>
              </ul>
            </article>
            <article className="rounded-2xl border-2 border-indigo-600 p-6 shadow-sm">
              <p className="mb-2 inline-flex rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                Mais vendido
              </p>
              <h3 className="text-lg font-semibold">Pro</h3>
              <p className="mt-2 text-3xl font-bold">R$ 599/mês</p>
              <p className="mt-1 text-sm text-slate-500">até 3.000 conversas/mês</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li>- 1 número WhatsApp</li>
                <li>- Fluxos avançados por segmento</li>
                <li>- Suporte prioritário</li>
              </ul>
            </article>
            <article className="rounded-2xl border border-slate-200 p-6">
              <h3 className="text-lg font-semibold">Scale</h3>
              <p className="mt-2 text-3xl font-bold">Sob consulta</p>
              <p className="mt-1 text-sm text-slate-500">operações com múltiplas unidades</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li>- 1 número WhatsApp</li>
                <li>- SLA e onboarding dedicado</li>
                <li>- personalização completa</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14">
        <div className="rounded-2xl bg-slate-900 px-6 py-10 text-center text-white">
          <h2 className="text-3xl font-bold">Pronto para escalar seu atendimento?</h2>
          <p className="mx-auto mt-2 max-w-2xl text-slate-300">
            Crie sua conta, conecte seu número e comece a automatizar hoje com
            IA + controle humano.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/registro"
              className="rounded-xl bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-400"
            >
              Criar conta
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-slate-600 px-6 py-3 font-medium text-slate-200 hover:bg-slate-800"
            >
              Já tenho acesso
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
