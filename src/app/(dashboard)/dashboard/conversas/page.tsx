import { MessageCircle } from "lucide-react";
import Link from "next/link";

export default function ConversasPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#0b141a] p-8">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-[#202c33] p-6">
          <MessageCircle className="h-16 w-16 text-[#8696a0]" />
        </div>
        <h2 className="text-2xl font-medium text-[#e9edef]">
          Mendoza IA
        </h2>
        <p className="max-w-md text-[#8696a0]">
          Envie e receba mensagens pelo WhatsApp. Mantenha seu celular conectado
          para sincronizar as conversas.
        </p>
        <Link
          href="/dashboard/whatsapp"
          className="mt-2 rounded-lg bg-[#00a884] px-6 py-2.5 font-medium text-white transition-colors hover:bg-[#06cf9c]"
        >
          Conectar WhatsApp
        </Link>
      </div>
    </div>
  );
}
