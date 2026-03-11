"use client";

import { useMemo, useState } from "react";
import { Plus, Tags, X } from "lucide-react";

type CategoryOption = {
  id: string;
  key: string;
  name: string;
};

type ProductsCreatePopupsProps = {
  categories: CategoryOption[];
  productPlaceholder: string;
  modelPlaceholder: string;
  categoryPlaceholder: string;
  aliasesPlaceholder: string;
  onCreateProduct: (formData: FormData) => Promise<void>;
  onCreateCategory: (formData: FormData) => Promise<void>;
};

export function ProductsCreatePopups({
  categories,
  productPlaceholder,
  modelPlaceholder,
  categoryPlaceholder,
  aliasesPlaceholder,
  onCreateProduct,
  onCreateCategory,
}: ProductsCreatePopupsProps) {
  const [isProductOpen, setIsProductOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);

  const defaultCategoryKey = useMemo(() => {
    return categories.find((category) => category.key === "outros")?.key ?? categories[0]?.key ?? "";
  }, [categories]);

  return (
    <>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Cadastros</h2>
            <p className="text-xs text-slate-500">
              Use os botoes para cadastrar novos produtos e categorias sem poluir a tela.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setIsProductOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            >
              <Plus className="h-4 w-4" />
              Novo produto
            </button>

            <button
              type="button"
              onClick={() => setIsCategoryOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <Tags className="h-4 w-4" />
              Nova categoria
            </button>
          </div>
        </div>
      </section>

      {isProductOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-[#131047]">Novo produto</h3>
                <p className="text-xs text-[#6C6C94]">
                  Cadastro rapido com categoria, preco, disponibilidade e descricao.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsProductOpen(false)}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Fechar cadastro de produto"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              action={onCreateProduct}
              encType="multipart/form-data"
              className="grid gap-4 px-5 py-4 md:grid-cols-12"
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
                  defaultValue={defaultCategoryKey}
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
          </div>
        </div>
      ) : null}

      {isCategoryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-[#131047]">Nova categoria</h3>
                <p className="text-xs text-[#6C6C94]">
                  Cadastre categoria e palavras-chave sem perder configuracoes atuais.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCategoryOpen(false)}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Fechar cadastro de categoria"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={onCreateCategory} className="grid gap-3 px-5 py-4">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Nome da categoria</span>
                <input
                  name="name"
                  required
                  placeholder={categoryPlaceholder}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Palavras-chave</span>
                <input
                  name="aliases"
                  placeholder={aliasesPlaceholder}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                />
              </label>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Adicionar categoria
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
