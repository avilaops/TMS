"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Truck, LogIn, Loader2 } from "lucide-react";
import { sair } from "@/lib/sair";

/**
 * O TMS não tem formulário de senha: quem autentica é o login único da Ávila
 * Ops (auth.avilaops.com), por OIDC. Esta tela só dispara a ida para lá. Na
 * volta, o NextAuth abre a sessão e a raiz (`/`) leva para a área da pessoa ou
 * para a escolha de empresa.
 *
 * Ela só fica parada em dois casos: quem acabou de sair (`?saiu=1`) e quem
 * voltou do auth com erro (`?error=`), para não ficar indo e voltando sem fim.
 */
export default function LoginPage() {
  const [estado, setEstado] = useState<"indo" | "saiu" | "erro">("indo");

  const entrar = () => {
    setEstado("indo");
    void signIn("avilaops", { callbackUrl: "/" });
  };

  const disparou = useRef(false);
  useEffect(() => {
    if (disparou.current) return;
    disparou.current = true;

    const query = new URLSearchParams(window.location.search);
    if (query.get("saiu") === "1") return setEstado("saiu");
    if (query.get("error")) return setEstado("erro");

    entrar();
  }, []);

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
              {estado === "indo" && "Abrindo o login da Ávila Ops…"}
              {estado === "saiu" && "Você saiu do sistema."}
              {estado === "erro" && "O acesso é feito com a sua conta Ávila Ops."}
            </p>
          </div>

          {estado === "indo" && (
            <div className="flex justify-center py-4" role="status" aria-label="Abrindo o login">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          )}

          {estado === "erro" && (
            <div
              role="alert"
              className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-xl text-sm"
            >
              Não foi possível entrar. Sua conta pode não ter acesso ao TMS: peça a liberação a quem administra a sua
              empresa, ou entre com outra conta.
            </div>
          )}

          {estado !== "indo" && (
            <button
              type="button"
              onClick={entrar}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>Entrar com Ávila Ops</span>
              <LogIn className="w-4 h-4" />
            </button>
          )}

          {estado === "erro" && (
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
