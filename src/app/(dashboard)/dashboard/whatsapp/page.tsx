import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Image from "next/image";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { SessionConnect } from "@/components/whatsapp/session-connect";
import { SyncWebhooksOnLoad } from "@/components/whatsapp/sync-webhooks";
import { MessageCircle, Smartphone, Sparkles } from "lucide-react";

export default async function WhatsAppPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const sessions = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.organizationId, org.id));

  return (
    <div className="p-8">
      <SyncWebhooksOnLoad sessionIds={sessions.map((s) => s.sessionId)} />

      <div className="mb-8 rounded-2xl border border-[var(--brand-muted)]/20 bg-white/80 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">WhatsApp</h1>
            <p className="mt-1 text-[var(--brand-muted)]">
              Conecte e gerencie sua sessão do WhatsApp
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-primary)]/20 bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]">
            <Sparkles className="h-3.5 w-3.5" />
            Conexão oficial
          </span>
        </div>
      </div>

      <div className="grid gap-6">
        {sessions.length === 0 ? (
          <div className="rounded-3xl border border-[var(--brand-muted)]/25 bg-white p-8 shadow-[0_12px_30px_-18px_rgba(19,16,71,0.45)]">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary)]/10">
                <MessageCircle className="h-7 w-7 text-[var(--brand-primary)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--brand-deep)]">Nenhuma sessão conectada</h3>
                <p className="text-sm text-[var(--brand-muted)]">
                  Conecte o WhatsApp para iniciar os atendimentos
                </p>
              </div>
            </div>
            <div className="mt-6">
              <WhatsAppConnect organizationId={org.id} />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {sessions.map((session) => {
              const isConnected = session.status === "connected";
              return (
                <div key={session.id} className="w-full max-w-[360px] space-y-4">
                  <article className="relative overflow-hidden rounded-3xl border border-[var(--brand-primary)]/25 bg-[var(--brand-deep)] p-5 text-white shadow-[0_16px_40px_-20px_rgba(19,16,71,0.9)]">
                    <div className="pointer-events-none absolute inset-0 opacity-40">
                      <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
                      <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
                      <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/5" />
                    </div>

                    <div className="relative z-10">
                      <div className="mb-5 flex items-start justify-between">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-white">
                          {isConnected ? (
                            <Image src="/whatsapp-icon.svg" alt="WhatsApp" width={20} height={20} />
                          ) : (
                            <Smartphone className="h-5 w-5 text-[var(--brand-deep)]/70" />
                          )}
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isConnected ? "bg-emerald-400" : "bg-slate-300"
                            }`}
                          />
                          {isConnected ? "Conectado" : "Desconectado"}
                        </div>
                      </div>

                      <h3 className="text-lg font-semibold leading-tight text-white">
                        {session.name || session.sessionId}
                      </h3>
                      <p className="mt-1 text-sm text-white/70">
                        {session.phoneNumber || "Sem número vinculado"}
                      </p>

                      <p className="mt-5 text-sm text-white/80">
                        {isConnected
                          ? "Sessão ativa e pronta para receber mensagens."
                          : "Conecte esta sessão para iniciar os atendimentos."}
                      </p>
                    </div>
                  </article>

                  {!isConnected ? <SessionConnect sessionId={session.sessionId} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
