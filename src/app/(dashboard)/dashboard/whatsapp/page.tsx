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
        <h1 className="text-2xl font-semibold text-white">WhatsApp</h1>
        <p className="mt-1 text-zinc-400">
          Conecte e gerencie suas sessões de WhatsApp
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-500/20">
                <MessageCircle className="h-7 w-7 text-green-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Nenhuma sessão</h3>
                <p className="text-sm text-zinc-400">
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
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {session.status === "connected" ? (
                      <Wifi className="h-8 w-8 text-green-500" />
                    ) : (
                      <WifiOff className="h-8 w-8 text-zinc-500" />
                    )}
                    <div>
                      <h3 className="font-medium text-white">
                        {session.name || session.sessionId}
                      </h3>
                      <p className="text-sm text-zinc-400">
                        {session.phoneNumber || session.status}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      session.status === "connected"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-zinc-700/50 text-zinc-400"
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

        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 p-8">
          <h3 className="font-medium text-zinc-300">Nova sessão</h3>
          <p className="mt-2 text-sm text-zinc-500">
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
