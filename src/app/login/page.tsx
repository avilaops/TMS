"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Truck, LogIn, Loader2 } from "lucide-react";
import { sair, urlDoLoginUnico } from "@/lib/sair";

const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: "/dashboard",
  OPERATION: "/dashboard",
  DRIVER: "/driver",
  CLIENT: "/portal",
};

/**
 * O TMS não tem formulário de senha: quem autentica é o login único da Ávila
 * Ops (auth.avilaops.com), com senha, Google, Microsoft ou Facebook. Esta tela
 * só faz a ponte:
 *
 * - chega aqui sem sessão do login único → vai direto para o auth;
 * - volta de lá (`?sso=1`) ou já tinha sessão → entra sem digitar nada;
 * - a conta existe em mais de uma empresa (ou é da equipe) → pede a empresa;
 * - a conta não tem acesso → explica e oferece trocar de conta.
 */
export default function LoginPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"entrando" | "parado">("entrando");
  const [erro, setErro] = useState("");
  const [saiu, setSaiu] = useState(false);
  const [empresa, setEmpresa] = useState("");
  const [pedirEmpresa, setPedirEmpresa] = useState(false);

  const entrar = async (slug = "") => {
    setEstado("entrando");
    setErro("");

    try {
      const res = await signIn("sso", { empresa: slug, redirect: false });

      if (!res?.error) {
        // Cada perfil tem a sua área; mandar todo mundo para /dashboard fazia
        // motorista e cliente caírem numa tela que o proxy vai barrar.
        const session = await getSession();
        router.push(HOME_BY_ROLE[session?.user?.role ?? ""] ?? "/dashboard");
        router.refresh();
        return;
      }

      // Sem sessão no auth: é lá que se entra. Se acabou de voltar de lá e
      // ainda não há sessão, para e mostra o erro em vez de ir e voltar sem fim.
      const voltouDoAuth = new URLSearchParams(window.location.search).get("sso") === "1";
      if (res.error.includes("Não há sessão do login único") && !voltouDoAuth) {
        window.location.href = urlDoLoginUnico(window.location.origin);
        return;
      }

      if (res.error.toLowerCase().includes("informe a empresa")) setPedirEmpresa(true);
      setErro(res.error);
      setEstado("parado");
    } catch {
      setErro("Não foi possível entrar agora. Tente de novo.");
      setEstado("parado");
    }
  };

  const tentou = useRef(false);
  useEffect(() => {
    if (tentou.current) return;
    tentou.current = true;

    // Quem acabou de sair não é posto para dentro de novo.
    if (new URLSearchParams(window.location.search).get("saiu") === "1") {
      setSaiu(true);
      setEstado("parado");
      return;
    }

    void entrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const precisaDaEmpresa = pedirEmpresa && estado === "parado";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 sm:p-10">
          <div className="flex flex-col items-center space-y-3 mb-8">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Truck className="text-white w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-4 font-outfit">TMS</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {estado === "entrando"
                ? "Entrando com a sua conta Ávila Ops…"
                : saiu
                  ? "Você saiu do sistema."
                  : "O acesso é feito com a sua conta Ávila Ops."}
            </p>
          </div>

          {estado === "entrando" && (
            <div className="flex justify-center py-4" role="status" aria-label="Entrando">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          )}

          {estado === "parado" && erro && (
            <div
              role="alert"
              className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-xl text-sm"
            >
              {erro}
            </div>
          )}

          {precisaDaEmpresa && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void entrar(empresa);
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="empresa" className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">
                  Empresa
                </label>
                <input
                  id="empresa"
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none dark:text-white"
                  placeholder="identificador da empresa"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
              >
                <span>Entrar</span>
                <LogIn className="w-4 h-4" />
              </button>
            </form>
          )}

          {estado === "parado" && !precisaDaEmpresa && (
            <button
              type="button"
              onClick={() => {
                window.location.href = urlDoLoginUnico(window.location.origin);
              }}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>Entrar com Ávila Ops</span>
              <LogIn className="w-4 h-4" />
            </button>
          )}

          {estado === "parado" && erro && (
            <button
              type="button"
              onClick={() => void sair()}
              className="w-full mt-3 py-3 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              Entrar com outra conta
            </button>
          )}
        </div>
        <p className="text-center text-sm text-gray-500 mt-8">© {new Date().getFullYear()} Avila Ops</p>
      </div>
    </div>
  );
}
