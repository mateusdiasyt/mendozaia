import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Image from "next/image";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { SessionConnectionActions } from "@/components/whatsapp/session-connection-actions";
import { SyncWebhooksOnLoad } from "@/components/whatsapp/sync-webhooks";
import {
  MessageCircle,
  Smartphone,
  Sparkles,
  Link2,
  ShieldCheck,
} from "lucide-react";
import {
  parseMetaChannelsSettings,
  toSafeMetaChannelView,
} from "@/lib/meta-channel-settings";
import {
  disconnectMetaChannels,
  setActiveMetaPage,
} from "@/app/actions/meta-channels";

export default async function WhatsAppPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const sessions = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.organizationId, org.id));

  const settings = (org.settings as Record<string, unknown> | undefined) ?? {};
  const metaChannels = parseMetaChannelsSettings(settings.metaChannels);
  const safeMetaChannels = toSafeMetaChannelView(metaChannels);

  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  const metaWebhookUrl = baseUrl
    ? `${baseUrl}/api/webhooks/meta`
    : "/api/webhooks/meta";

  const whatsappOnlySessions = sessions.filter(
    (session) => !session.sessionId.startsWith("meta-")
  );

  return (
    <div className="p-8">
      <SyncWebhooksOnLoad sessionIds={sessions.map((s) => s.sessionId)} />

      <div className="mb-8 rounded-2xl border border-[var(--brand-muted)]/20 bg-white/80 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
              Canais
            </h1>
            <p className="mt-1 text-[var(--brand-muted)]">
              Conecte WhatsApp, Instagram e Messenger para atendimento unificado.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-primary)]/20 bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]">
            <Sparkles className="h-3.5 w-3.5" />
            Conexao oficial
          </span>
        </div>
      </div>

      <div className="grid gap-6">
        <div className="rounded-3xl border border-[var(--brand-muted)]/25 bg-white p-6 shadow-[0_12px_30px_-18px_rgba(19,16,71,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
                Meta (Instagram + Messenger)
              </h2>
              <p className="mt-1 text-sm text-[var(--brand-muted)]">
                Cada cliente conecta sua propria pagina e Instagram via OAuth.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/meta/oauth/start"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-deep)]"
              >
                <Link2 className="h-4 w-4" />
                Conectar Meta
              </a>
              {safeMetaChannels.length > 0 ? (
                <form action={disconnectMetaChannels}>
                  <button
                    type="submit"
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    Desconectar
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)]/35 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
                Webhook Meta
              </p>
              <p className="mt-2 break-all text-sm text-[var(--brand-deep)]">
                {metaWebhookUrl}
              </p>
              <p className="mt-2 text-xs text-[var(--brand-muted)]">
                Configure este endpoint no app da Meta para receber mensagens.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)]/35 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
                Status
              </p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                {safeMetaChannels.length > 0
                  ? `${safeMetaChannels.length} pagina(s) conectada(s)`
                  : "Nenhuma pagina conectada"}
              </div>
              <p className="mt-2 text-xs text-[var(--brand-muted)]">
                A aprovacao da Meta e feita uma vez no seu app.
              </p>
            </div>
          </div>

          {safeMetaChannels.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {safeMetaChannels.map((channel) => (
                <div
                  key={channel.pageId}
                  className="rounded-2xl border border-[var(--brand-muted)]/20 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                        {channel.pageName}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--brand-muted)]">
                        Page ID: {channel.pageId}
                      </p>
                      <p className="mt-1 text-xs text-[var(--brand-muted)]">
                        Instagram: {channel.instagramUsername || "Nao vinculado"}
                      </p>
                    </div>
                    {channel.isActive ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        Principal
                      </span>
                    ) : (
                      <form action={setActiveMetaPage}>
                        <input type="hidden" name="pageId" value={channel.pageId} />
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-full border border-[var(--brand-muted)]/25 px-2 py-1 text-[11px] font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)]"
                        >
                          Usar
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-[var(--brand-muted)]/30 bg-[var(--brand-soft)]/30 p-4 text-sm text-[var(--brand-muted)]">
              Clique em "Conectar Meta" para habilitar Instagram e Messenger.
            </div>
          )}
        </div>

        {whatsappOnlySessions.length === 0 ? (
          <div className="rounded-3xl border border-[var(--brand-muted)]/25 bg-white p-8 shadow-[0_12px_30px_-18px_rgba(19,16,71,0.45)]">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary)]/10">
                <MessageCircle className="h-7 w-7 text-[var(--brand-primary)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--brand-deep)]">
                  Nenhuma sessao WhatsApp conectada
                </h3>
                <p className="text-sm text-[var(--brand-muted)]">
                  Conecte o WhatsApp para iniciar os atendimentos desse canal.
                </p>
              </div>
            </div>
            <div className="mt-6">
              <WhatsAppConnect organizationId={org.id} />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {whatsappOnlySessions.map((session) => {
              const isConnected = session.status === "connected";
              return (
                <div key={session.id} className="w-full max-w-[360px]">
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
                        {session.phoneNumber || "Sem numero vinculado"}
                      </p>

                      <p className="mt-5 text-sm text-white/80">
                        {isConnected
                          ? "Sessao ativa e pronta para receber mensagens."
                          : "Conecte esta sessao para iniciar os atendimentos."}
                      </p>

                      <SessionConnectionActions
                        sessionId={session.sessionId}
                        connected={isConnected}
                      />
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
