import {
  createProductCategory,
  createProduct,
  listProductCategories,
  listProducts,
  toggleProductActive,
  updateProductCategory,
  updateProductDetails,
  updateProductCategoryDefinition,
  updateProductStockStatus,
} from "@/app/actions/products";
import { getCurrentOrganization } from "@/lib/auth-utils";

function formatCurrencyFromCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatPriceInputFromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function getCategoryCoverSeed(name: string, categoryKey: string | null): string {
  const base = `${categoryKey ?? "produto"}-${name}`.toLowerCase().replace(/\s+/g, "-");
  return encodeURIComponent(base);
}

function getCategoryLabel(
  categoryKey: string | null,
  categoriesByKey: Map<string, string>
): string {
  if (!categoryKey) return "Sem categoria";
  return categoriesByKey.get(categoryKey) ?? categoryKey;
}

function categoryTone(isActive: boolean): string {
  return isActive
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

function stockTone(isInStock: boolean): string {
  return isInStock
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

export default async function ProdutosPage() {
  const org = await getCurrentOrganization();
  const settings = (org?.settings as Record<string, unknown> | undefined) ?? {};
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const segment =
    (botConfig.segment as "mecanica" | "restaurante" | "geral" | undefined) ?? "mecanica";
  const pageTitle = segment === "restaurante" ? "Cardapio" : "Produtos";
  const pageDescription =
    segment === "restaurante"
      ? "Organize seus itens em cards visuais para consulta automatica da IA."
      : "Organize seus produtos em cards visuais para consulta automatica da IA.";
  const categoryPlaceholder =
    segment === "restaurante"
      ? "Nome da categoria (ex: Sobremesa)"
      : "Nome da categoria (ex: Fluido)";
  const aliasesPlaceholder =
    segment === "restaurante"
      ? "Palavras-chave (ex: doce, sobremesa, pudim)"
      : "Palavras-chave (ex: fluido, aditivo)";
  const productPlaceholder =
    segment === "restaurante" ? "Nome (ex: Lasanha da casa)" : "Nome (ex: Oleo 5W30)";
  const modelPlaceholder =
    segment === "restaurante"
      ? "Marca/variacao (opcional)"
      : "Modelo/Marca (opcional)";

  const { products } = await listProducts();
  const { categories } = await listProductCategories();

  const categoriesByKey = new Map(categories.map((category) => [category.key, category.name]));
  const activeProducts = products.filter((item) => item.isActive).length;
  const inStockProducts = products.filter((item) => item.isInStock).length;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{pageTitle}</h1>
            <p className="text-sm text-slate-500">{pageDescription}</p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Itens
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{products.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Ativos
              </p>
              <p className="mt-1 text-xl font-semibold text-emerald-800">{activeProducts}</p>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                Em estoque
              </p>
              <p className="mt-1 text-xl font-semibold text-indigo-800">{inStockProducts}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid items-start gap-5 xl:grid-cols-12">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-7">
          <div className="mb-5 space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Novo produto</h2>
            <p className="text-xs text-slate-500">
              Cadastro rapido com categoria, preco, disponibilidade e descricao.
            </p>
          </div>

          <form
            action={async (formData) => {
              "use server";
              await createProduct(formData);
            }}
            encType="multipart/form-data"
            className="grid gap-4 md:grid-cols-12"
          >
            <label className="space-y-1.5 md:col-span-12">
              <span className="text-xs font-semibold text-slate-600">Nome do item</span>
              <input
                name="name"
                required
                placeholder={productPlaceholder}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>

            <label className="space-y-1.5 md:col-span-7">
              <span className="text-xs font-semibold text-slate-600">Modelo/Marca</span>
              <input
                name="model"
                placeholder={modelPlaceholder}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>

            <label className="space-y-1.5 md:col-span-5">
              <span className="text-xs font-semibold text-slate-600">Preco</span>
              <input
                name="price"
                required
                placeholder="Ex: 79,90"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>

            <label className="space-y-1.5 md:col-span-6">
              <span className="text-xs font-semibold text-slate-600">Categoria</span>
              <select
                name="category"
                defaultValue={categories.find((c) => c.key === "outros")?.key ?? ""}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.key}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 md:col-span-6">
              <span className="text-xs font-semibold text-slate-600">Disponibilidade</span>
              <select
                name="isInStock"
                defaultValue="yes"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
              >
                <option value="yes">Disponivel</option>
                <option value="no">Indisponivel</option>
              </select>
            </label>

            <label className="space-y-1.5 md:col-span-12">
              <span className="text-xs font-semibold text-slate-600">Descricao</span>
              <input
                name="description"
                placeholder="Opcional: detalhe, aplicacao, observacao"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>

            <label className="space-y-1.5 md:col-span-12">
              <span className="text-xs font-semibold text-slate-600">Foto do produto (opcional)</span>
              <input
                name="imageFile"
                type="file"
                accept="image/*"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
              />
            </label>

            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-4 lg:col-span-3">
              <input type="checkbox" name="isActive" defaultChecked />
              Ativo
            </label>

            <div className="md:col-span-12 md:flex md:justify-end">
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--brand-primary)] px-7 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 md:w-auto"
              >
                Salvar produto
              </button>
            </div>
          </form>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-5">
          <div className="mb-4 space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Categorias</h2>
            <p className="text-xs text-slate-500">
              Ajuste nome, palavras-chave e status das categorias sem perder configuracoes atuais.
            </p>
          </div>

          <form
            action={async (formData) => {
              "use server";
              await createProductCategory(formData);
            }}
            className="grid gap-2.5 sm:grid-cols-12"
          >
            <input
              name="name"
              required
              placeholder={categoryPlaceholder}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm sm:col-span-4"
            />
            <input
              name="aliases"
              placeholder={aliasesPlaceholder}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm sm:col-span-5"
            />
            <button
              type="submit"
              className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 sm:col-span-3"
            >
              Adicionar categoria
            </button>
          </form>

          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {categories.map((category) => (
              <form
                key={category.id}
                action={async (formData) => {
                  "use server";
                  await updateProductCategoryDefinition(formData);
                }}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5"
              >
                <input type="hidden" name="id" value={category.id} />
                <div className="grid gap-2 sm:grid-cols-12">
                  <input
                    name="name"
                    defaultValue={category.name}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:col-span-4"
                  />
                  <input
                    name="aliases"
                    defaultValue={category.aliases ?? ""}
                    placeholder="Palavras-chave separadas por virgula"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:col-span-6"
                  />
                  <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-stretch">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="isActive" defaultChecked={category.isActive} />
                      Ativa
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              </form>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Catalogo visual</h2>
            <p className="text-xs text-slate-500">
              Cards minimalistas com imagem, status e acoes rapidas de configuracao.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            {products.length} item(ns)
          </span>
        </div>

        {products.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
            Nenhum produto cadastrado ainda.
          </div>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {products.map((item) => {
              const categoryLabel = getCategoryLabel(item.category, categoriesByKey);
              return (
                <article
                  key={item.id}
                  className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden">
                    <img
                      src={
                        item.imageUrl ??
                        `https://picsum.photos/seed/${getCategoryCoverSeed(item.name, item.category)}/640/640`
                      }
                      alt={`Imagem do produto ${item.name}`}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-900/25 to-transparent" />

                    <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stockTone(item.isInStock)}`}
                      >
                        {item.isInStock ? "Em estoque" : "Sem estoque"}
                      </span>
                      <span className="rounded-full border border-white/40 bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                        {categoryLabel}
                      </span>
                    </div>

                    <span
                      className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${
                        item.isActive
                          ? "border-emerald-300 bg-emerald-100/90 text-emerald-800"
                          : "border-slate-300 bg-slate-100/90 text-slate-700"
                      }`}
                    >
                      {item.isActive ? "Ativo" : "Inativo"}
                    </span>

                    <div className="absolute bottom-3 left-3 right-3">
                      <p className="line-clamp-1 text-base font-semibold text-white">{item.name}</p>
                      {item.model ? (
                        <p className="line-clamp-1 text-xs text-white/85">{item.model}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-lg font-semibold text-slate-900">
                        {formatCurrencyFromCents(item.priceCents)}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${categoryTone(item.isActive)}`}
                      >
                        {item.isActive ? "Publicado" : "Oculto"}
                      </span>
                    </div>

                    {item.description ? (
                      <p className="line-clamp-2 text-xs text-slate-500">{item.description}</p>
                    ) : (
                      <p className="text-xs text-slate-400">Sem descricao cadastrada.</p>
                    )}

                    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-slate-700">
                        Editar informacoes
                      </summary>
                      <form
                        action={async (formData) => {
                          "use server";
                          await updateProductDetails(formData);
                        }}
                        encType="multipart/form-data"
                        className="mt-3 grid gap-2 sm:grid-cols-2"
                      >
                        <input type="hidden" name="id" value={item.id} />

                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-[11px] font-medium text-slate-600">Nome</span>
                          <input
                            name="name"
                            required
                            defaultValue={item.name}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-600">Modelo/Marca</span>
                          <input
                            name="model"
                            defaultValue={item.model ?? ""}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-600">Preco</span>
                          <input
                            name="price"
                            required
                            defaultValue={formatPriceInputFromCents(item.priceCents)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-600">Categoria</span>
                          <select
                            name="category"
                            defaultValue={item.category || "outros"}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            {categories.map((category) => (
                              <option key={category.id} value={category.key}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] font-medium text-slate-600">Disponibilidade</span>
                          <select
                            name="isInStock"
                            defaultValue={item.isInStock ? "yes" : "no"}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="yes">Disponivel</option>
                            <option value="no">Indisponivel</option>
                          </select>
                        </label>

                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-[11px] font-medium text-slate-600">Descricao</span>
                          <input
                            name="description"
                            defaultValue={item.description ?? ""}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          />
                        </label>

                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-[11px] font-medium text-slate-600">Trocar foto</span>
                          <input
                            name="imageFile"
                            type="file"
                            accept="image/*"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-slate-700"
                          />
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" name="isActive" defaultChecked={item.isActive} />
                          Ativo
                        </label>

                        {item.imageUrl ? (
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <input type="checkbox" name="removeImage" />
                            Remover foto atual
                          </label>
                        ) : null}

                        <div className="sm:col-span-2">
                          <button
                            type="submit"
                            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            Salvar alteracoes
                          </button>
                        </div>
                      </form>
                    </details>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <form
                        action={async (formData) => {
                          "use server";
                          const id = String(formData.get("id") ?? "");
                          const category = String(formData.get("category") ?? "");
                          if (!id || !category) return;
                          await updateProductCategory(id, category);
                        }}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5"
                      >
                        <input type="hidden" name="id" value={item.id} />
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Categoria
                        </p>
                        <div className="flex items-center gap-2">
                          <select
                            name="category"
                            defaultValue={item.category || "outros"}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            {categories.map((category) => (
                              <option key={category.id} value={category.key}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Salvar
                          </button>
                        </div>
                      </form>

                      <form
                        action={async (formData) => {
                          "use server";
                          const id = String(formData.get("id") ?? "");
                          const inStock = String(formData.get("isInStock") ?? "yes") === "yes";
                          if (!id) return;
                          await updateProductStockStatus(id, inStock);
                        }}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5"
                      >
                        <input type="hidden" name="id" value={item.id} />
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Estoque
                        </p>
                        <div className="flex items-center gap-2">
                          <select
                            name="isInStock"
                            defaultValue={item.isInStock ? "yes" : "no"}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="yes">Disponivel</option>
                            <option value="no">Indisponivel</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Salvar
                          </button>
                        </div>
                      </form>
                    </div>

                    <form
                      action={async (formData) => {
                        "use server";
                        const id = String(formData.get("id") ?? "");
                        const next = String(formData.get("next") ?? "0") === "1";
                        if (!id) return;
                        await toggleProductActive(id, next);
                      }}
                    >
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="next" value={item.isActive ? "0" : "1"} />
                      <button
                        type="submit"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {item.isActive ? "Desativar item" : "Ativar item"}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
