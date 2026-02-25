import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { SessionConnect } from "@/components/whatsapp/session-connect";
import { MessageCircle, Wifi, WifiOff } from "lucide-react";

export default async function WhatsAppPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const sessions = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.organizationId, org.id));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">WhatsApp</h1>
        <p className="mt-1 text-slate-500">
          Conecte e gerencie suas sessões de WhatsApp
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-50">
                <MessageCircle className="h-7 w-7 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900">Nenhuma sessão</h3>
                <p className="text-sm text-slate-500">
                  Conecte sua primeira sessão de WhatsApp
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
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {session.status === "connected" ? (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                        <Wifi className="h-5 w-5 text-emerald-600" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                        <WifiOff className="h-5 w-5 text-slate-400" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-medium text-slate-900">
                        {session.name || session.sessionId}
                      </h3>
                      <p className="text-sm text-slate-500">
                        {session.phoneNumber || session.status}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      session.status === "connected"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {session.status}
                  </span>
                </div>

                {(session.status === "disconnected" ||
                  session.status === "connecting") && (
                  <div className="mt-6">
                    <SessionConnect sessionId={session.sessionId} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8">
          <h3 className="font-medium text-slate-700">Nova sessão</h3>
          <p className="mt-2 text-sm text-slate-500">
            Adicione outra conta de WhatsApp
          </p>
          <div className="mt-4">
            <WhatsAppConnect organizationId={org.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
