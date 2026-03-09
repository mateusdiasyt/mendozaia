import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { SessionConnect } from "@/components/whatsapp/session-connect";
import { SyncWebhooksOnLoad } from "@/components/whatsapp/sync-webhooks";
import {
  MessageCircle,
  Wifi,
  WifiOff,
  Smartphone,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

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
          sessions.map((session) => (
            <div key={session.id} className="space-y-4">
              <div className="overflow-hidden rounded-3xl border border-[var(--brand-muted)]/20 bg-white shadow-[0_14px_36px_-22px_rgba(19,16,71,0.5)] transition-all duration-200 hover:translate-y-[-1px] hover:shadow-[0_18px_40px_-20px_rgba(19,16,71,0.55)]">
                <div className="relative border-b border-[var(--brand-muted)]/15 bg-gradient-to-r from-[var(--brand-primary)]/10 via-white to-[var(--brand-accent)]/20 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {session.status === "connected" ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--brand-primary)]/20 bg-[var(--brand-soft)]">
                          <Wifi className="h-5 w-5 text-[var(--brand-primary)]" />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)]">
                          <WifiOff className="h-5 w-5 text-[var(--brand-muted)]" />
                        </div>
                      )}

                      <div>
                        <h3 className="text-lg font-semibold text-[var(--brand-deep)]">
                          {session.name || session.sessionId}
                        </h3>
                        <p className="text-sm text-[var(--brand-muted)]">
                          {session.phoneNumber || "Sem número vinculado"}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                        session.status === "connected"
                          ? "border border-[var(--brand-primary)]/25 bg-[var(--brand-soft)] text-[var(--brand-primary)]"
                          : "border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] text-[var(--brand-muted)]"
                      }`}
                    >
                      {session.status === "connected" ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Smartphone className="h-3.5 w-3.5" />
                      )}
                      {session.status === "connected" ? "Conectado" : "Desconectado"}
                    </span>
                  </div>
                </div>

                <div className="p-6">
                  {session.status === "connected" ? (
                    <div className="rounded-2xl border border-[var(--brand-accent)]/35 bg-[var(--brand-accent)]/12 px-4 py-3 text-sm text-[var(--brand-deep)]">
                      Sessão ativa e pronta para receber e enviar mensagens.
                    </div>
                  ) : (
                    <div>
                      <p className="mb-4 text-sm text-[var(--brand-muted)]">
                        Escaneie o QR Code para conectar esta sessão.
                      </p>
                      <SessionConnect sessionId={session.sessionId} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
