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

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">WhatsApp</h1>
        <p className="mt-1 text-[var(--brand-muted)]">
          Conecte e gerencie sua sessão do WhatsApp
        </p>
      </div>

      <div className="grid gap-6">
        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-[var(--brand-muted)]/25 bg-white p-8 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--brand-primary)]/10">
                <MessageCircle className="h-7 w-7 text-[var(--brand-primary)]" />
              </div>
              <div>
                <h3 className="font-medium text-[var(--brand-deep)]">Nenhuma sessão conectada</h3>
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
              <div className="overflow-hidden rounded-2xl border border-[var(--brand-muted)]/25 bg-white shadow-sm">
                <div className="relative border-b border-[var(--brand-muted)]/15 bg-gradient-to-r from-[var(--brand-primary)]/8 via-white to-[var(--brand-accent)]/10 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {session.status === "connected" ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50">
                          <Wifi className="h-5 w-5 text-emerald-600" />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)]">
                          <WifiOff className="h-5 w-5 text-[var(--brand-muted)]" />
                        </div>
                      )}

                      <div>
                        <h3 className="font-semibold text-[var(--brand-deep)]">
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
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] text-[var(--brand-muted)]"
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
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-700">
                      Sessão ativa e pronta para receber/enviar mensagens.
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
