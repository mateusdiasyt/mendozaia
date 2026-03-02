import { createService, listServices, toggleServiceActive } from "@/app/actions/services";
import { getCurrentOrganization } from "@/lib/auth-utils";

function formatCurrencyFromCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default async function ServicosPage() {
  const org = await getCurrentOrganization();
  const settings = (org?.settings as Record<string, unknown> | undefined) ?? {};
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const segment =
    (botConfig.segment as "mecanica" | "restaurante" | "geral" | undefined) ?? "mecanica";
  const pageTitle = segment === "restaurante" ? "Reservas de mesa" : "Serviços";
  const pageDescription =
    segment === "restaurante"
      ? "Cadastre tipos de reserva/atendimento para orientação automática no WhatsApp."
      : "Cadastre serviços para orçamento e orientação automática no WhatsApp.";
  const namePlaceholder =
    segment === "restaurante" ? "Nome (ex: Reserva jantar)" : "Nome (ex: Troca de óleo)";

  const { services } = await listServices();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">{pageTitle}</h1>
        <p className="mt-1 text-slate-500">{pageDescription}</p>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-medium text-slate-900">Novo serviço</h2>
        <form
          action={async (formData) => {
            "use server";
            await createService(formData);
          }}
          className="mt-4 grid gap-4 md:grid-cols-2"
        >
          <input
            name="name"
            required
            placeholder={namePlaceholder}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          />
          <input
            name="price"
            required
            placeholder="Preço (ex: 120,00)"
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          />
          <input
            name="durationMinutes"
            type="number"
            min={1}
            defaultValue={60}
            placeholder="Duração (min)"
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isActive" defaultChecked />
            Ativo
          </label>
          <input
            name="description"
            placeholder="Descrição (opcional)"
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm md:col-span-2"
          />
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Salvar serviço
            </button>
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Serviço</th>
              <th className="px-4 py-3">Preço</th>
              <th className="px-4 py-3">Duração</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {services.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{item.name}</p>
                  {item.description ? (
                    <p className="text-xs text-slate-500">{item.description}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {formatCurrencyFromCents(item.priceCents)}
                </td>
                <td className="px-4 py-3 text-slate-700">{item.durationMinutes} min</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {item.isActive ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <form
                    action={async (formData) => {
                      "use server";
                      const id = String(formData.get("id") ?? "");
                      const next = String(formData.get("next") ?? "0") === "1";
                      if (!id) return;
                      await toggleServiceActive(id, next);
                    }}
                  >
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="next" value={item.isActive ? "0" : "1"} />
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {item.isActive ? "Desativar" : "Ativar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {services.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Nenhum serviço cadastrado ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
