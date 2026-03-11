import Link from "next/link";
import { RedefinirSenhaForm } from "./redefinir-senha-form";

type SearchParamsInput =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

async function resolveSearchParams(
  input: SearchParamsInput | undefined
): Promise<Record<string, string | string[] | undefined>> {
  if (!input) return {};
  if ("then" in input && typeof input.then === "function") {
    return input;
  }
  return input;
}

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const token =
    typeof resolvedSearchParams.token === "string"
      ? resolvedSearchParams.token
      : "";
  const userId =
    typeof resolvedSearchParams.uid === "string"
      ? resolvedSearchParams.uid
      : "";

  const invalidLink = token.length === 0 || userId.length === 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Redefinir senha
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Defina uma nova senha para acessar sua conta.
        </p>

        {invalidLink ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Link invalido. Solicite uma nova redefinicao de senha.
          </div>
        ) : (
          <div className="mt-6">
            <RedefinirSenhaForm userId={userId} token={token} />
          </div>
        )}

        <p className="mt-5 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Ir para login
          </Link>
        </p>
      </div>
    </div>
  );
}
