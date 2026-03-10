import { createService, listServices, updateService } from "@/app/actions/services";
import { getCurrentOrganization } from "@/lib/auth-utils";

function formatCurrencyFromCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCurrencyInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
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
      ? "Cadastre os tipos de atendimento para orientar reservas no WhatsApp."
      : "Cadastre serviços para orçamento e orientação automática no WhatsApp.";
  const namePlaceholder =
    segment === "restaurante" ? "Ex.: Reserva jantar" : "Ex.: Troca de óleo";
  const durationLabel = segment === "restaurante" ? "Duração média" : "Duração";

  const { services } = await listServices();

  return (
    <div className="mx-auto w-full max-w-[1360px] p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">{pageTitle}</h1>
        <p className="mt-1 text-sm text-[var(--brand-muted)]">{pageDescription}</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--brand-muted)]/25 bg-[var(--brand-surface)] p-5 shadow-sm xl:sticky xl:top-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">Novo serviço</h2>
            <p className="text-xs text-[var(--brand-muted)]">
              Formulário compacto para manter o cadastro rápido.
            </p>
          </div>

          <form
            action={async (formData) => {
              "use server";
              await createService(formData);
            }}
            className="space-y-3.5"
          >
            <input
              name="name"
              required
              placeholder={namePlaceholder}
              className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                name="price"
                required
                placeholder="Preço (ex: 120,00)"
                className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
              />
              <input
                name="durationMinutes"
                type="number"
                min={1}
                defaultValue={60}
                placeholder="Min"
                className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
              />
            </div>

            <textarea
              name="description"
              rows={3}
              placeholder="Descrição (opcional)"
              className="w-full resize-none rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
            />

            <div className="space-y-2 rounded-xl border border-[var(--brand-muted)]/25 bg-white p-3">
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input type="checkbox" name="isActive" defaultChecked />
                Ativo
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input type="checkbox" name="requiresHuman" />
                Precisa de atendimento humano
              </label>
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Salvar serviço
            </button>
          </form>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
              Serviços cadastrados
            </h2>
            <span className="rounded-full bg-[var(--brand-primary)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)]">
              {services.length} item(ns)
            </span>
          </div>

          {services.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--brand-muted)]/30 bg-white px-4 py-10 text-center text-sm text-[var(--brand-muted)]">
              Nenhum serviço cadastrado ainda.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {services.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-[var(--brand-muted)]/25 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--brand-deep)]">{item.name}</h3>
                      {item.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--brand-muted)]">
                          {item.description}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-[var(--brand-muted)]">Sem descrição.</p>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {item.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-lg border border-[var(--brand-muted)]/25 bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]">
                      {formatCurrencyFromCents(item.priceCents)}
                    </span>
                    <span className="rounded-lg border border-[var(--brand-muted)]/25 bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]">
                      {durationLabel}: {item.durationMinutes} min
                    </span>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                        item.requiresHuman
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      Atendimento humano: {item.requiresHuman ? "Sim" : "Não"}
                    </span>
                  </div>

                  <details className="group mt-4">
                    <summary className="list-none cursor-pointer rounded-lg border border-[var(--brand-muted)]/25 px-3 py-2 text-sm text-[var(--brand-deep)] transition hover:bg-[var(--brand-soft)]">
                      <span className="font-medium">Editar informações</span>
                      <span className="ml-2 text-xs text-[var(--brand-muted)]">toque para abrir</span>
                    </summary>

                    <form
                      action={async (formData) => {
                        "use server";
                        await updateService(formData);
                      }}
                      className="mt-3 space-y-3 rounded-xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] p-3"
                    >
                      <input type="hidden" name="id" value={item.id} />

                      <input
                        name="name"
                        required
                        defaultValue={item.name}
                        className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <input
                          name="price"
                          required
                          defaultValue={formatCurrencyInput(item.priceCents)}
                          className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
                        />
                        <input
                          name="durationMinutes"
                          type="number"
                          min={1}
                          defaultValue={item.durationMinutes}
                          className="w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
                        />
                      </div>

                      <textarea
                        name="description"
                        rows={3}
                        defaultValue={item.description ?? ""}
                        placeholder="Descrição (opcional)"
                        className="w-full resize-none rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
                      />

                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                          <input type="checkbox" name="isActive" defaultChecked={item.isActive} />
                          Ativo
                        </label>
                        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                          <input
                            type="checkbox"
                            name="requiresHuman"
                            defaultChecked={item.requiresHuman}
                          />
                          Precisa de atendimento humano
                        </label>
                      </div>

                      <button
                        type="submit"
                        className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
                      >
                        Salvar alterações
                      </button>
                    </form>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
