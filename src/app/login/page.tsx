"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Truck, LogIn, Loader2, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: "/dashboard",
  OPERATION: "/dashboard",
  DRIVER: "/driver",
  CLIENT: "/portal",
};

// Login único da Ávila Ops. O identificador é o do cadastro de aplicações de lá.
const SSO_URL = "https://auth.avilaops.com";
const SSO_APP = "tms";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // O campo só aparece quando o mesmo acesso existe em mais de uma empresa.
  const [empresa, setEmpresa] = useState("");
  const [pedirEmpresa, setPedirEmpresa] = useState(false);
  const [loading, setLoading] = useState(false);

  // Depois de um login (senha ou login único), cada perfil vai para a sua área.
  const irParaAArea = async () => {
    const session = await getSession();
    router.push(HOME_BY_ROLE[session?.user?.role ?? ""] ?? "/dashboard");
    router.refresh();
  };

  // Login único da Ávila Ops. Sem sessão lá, o auth pede o login e devolve para
  // cá com `?sso=1`; com sessão, a entrada acontece sem digitar senha.
  const entrarComLoginUnico = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await signIn("sso", { empresa: pedirEmpresa ? empresa : "", redirect: false });

      if (!res?.error) {
        await irParaAArea();
        return;
      }

      const jaVoltouDoAuth = new URLSearchParams(window.location.search).get("sso") === "1";
      if (res.error.includes("Não há sessão do login único") && !jaVoltouDoAuth) {
        const volta = `${window.location.origin}/login?sso=1`;
        window.location.href = `${SSO_URL}/login?app=${SSO_APP}&returnTo=${encodeURIComponent(volta)}`;
        return;
      }

      if (res.error.toLowerCase().includes("informe a empresa")) setPedirEmpresa(true);
      setError(res.error);
      setLoading(false);
    } catch {
      setError("Erro interno ao tentar fazer login");
      setLoading(false);
    }
  };

  // Voltando do auth: tenta a entrada sozinho, uma vez.
  const tentouAoVoltar = useRef(false);
  useEffect(() => {
    if (tentouAoVoltar.current) return;
    if (new URLSearchParams(window.location.search).get("sso") !== "1") return;
    tentouAoVoltar.current = true;
    void entrarComLoginUnico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        email,
        password,
        empresa: pedirEmpresa ? empresa : "",
        redirect: false,
      });

      if (res?.error) {
        if (res.error.toLowerCase().includes("informe a empresa")) setPedirEmpresa(true);
        setError(res.error);
        setLoading(false);
      } else {
        // Cada perfil tem a sua área; mandar todo mundo para /dashboard fazia
        // motorista e cliente caírem numa tela que o proxy vai barrar.
        const session = await getSession();
        router.push(HOME_BY_ROLE[session?.user?.role ?? ""] ?? "/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError("Erro interno ao tentar fazer login");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
      {/* Background Decorators */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-blue-500/20 dark:bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] bg-indigo-500/20 dark:bg-indigo-600/10 blur-[120px] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10 px-4"
      >
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] border border-white/20 dark:border-gray-700/50 p-8 sm:p-10">
          <div className="flex flex-col items-center justify-center space-y-3 mb-8">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Truck className="text-white w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-4 font-outfit">Mello Gestão</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Entre com suas credenciais de acesso</p>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm text-center"
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                placeholder="nome@empresa.com"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                placeholder="••••••••"
              />
            </div>

            {pedirEmpresa && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 ml-1">Empresa</label>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoComplete="organization"
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="identificador da empresa"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed group"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>Entrar</span>
                  <LogIn className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={entrarComLoginUnico}
              disabled={loading}
              className="w-full py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900/50 font-medium transition-all flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Entrar com Ávila Ops</span>
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-gray-500 dark:text-gray-500 mt-8">
          © {new Date().getFullYear()} Avila Ops
        </p>
      </motion.div>
    </div>
  );
}
