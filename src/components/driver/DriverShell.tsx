"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sair } from "@/lib/sair";
import { Truck, Map, User, LogOut, CloudOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  type BlockedBaixa,
  SESSION_EXPIRED_MESSAGE,
  countPending,
  discardPending,
  flushQueue,
  rememberOwner,
  rememberedOwner,
  resolveSyncOwner,
} from "@/lib/offline-queue";

function subscribeToConnection(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

export default function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // No servidor não há `navigator`: a página sai como "online" e acerta ao hidratar.
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const { data: session, status } = useSession();
  // Só a sessão confirmada pelo servidor autoriza o reenvio em nome de alguém.
  // O provedor pode ficar sem usuário por uma consulta feita sem sinal; nesse
  // caso o `sync` confirma direto no servidor.
  const userId = status === "authenticated" ? (session?.user?.id ?? null) : null;
  const [pending, setPending] = useState(0);
  // Baixas de outro motorista neste aparelho: não sobem na sessão deste.
  const [othersPending, setOthersPending] = useState(0);
  // Baixas que o servidor não aceita e que não sobem sozinhas (cadastro parado).
  const [blocked, setBlocked] = useState<BlockedBaixa[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState("");
  // O servidor disse que não há sessão (na consulta ou com 401 no reenvio):
  // as baixas seguem no aparelho.
  const [sessionExpired, setSessionExpired] = useState(false);

  const refreshPending = useCallback(() => {
    // Sem a sessão carregada (sem sinal), conta pelo último usuário confirmado.
    countPending(userId ?? rememberedOwner())
      .then(({ mine, others }) => {
        setPending(mine);
        setOthersPending(others);
      })
      .catch(() => {
        setPending(0);
        setOthersPending(0);
      });
  }, [userId]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { owner, sessionExpired: expired } = await resolveSyncOwner(userId);
      if (!owner) {
        // Sem resposta do servidor, o aviso de sessão fica como estava.
        if (expired) setSessionExpired(true);
        return;
      }
      rememberOwner(owner);
      const result = await flushQueue(owner);
      if (result.sent > 0) {
        setFeedback(
          `${result.sent} ${result.sent === 1 ? "baixa enviada" : "baixas enviadas"}.`
        );
      }
      if (result.rejected.length > 0) {
        setFeedback(`Recusado pelo servidor: ${result.rejected[0].reason}`);
      }
      setSessionExpired(result.needsLogin);
      setBlocked(result.blocked);
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [syncing, userId, refreshPending]);

  const discardBlocked = useCallback(async () => {
    const count = blocked.length;
    const confirmed = window.confirm(
      `Apagar ${count} ${count === 1 ? "baixa salva" : "baixas salvas"} neste aparelho? ` +
        "O comprovante (recebedor, foto e assinatura) será perdido e a entrega continuará sem baixa."
    );
    if (!confirmed) return;
    await discardPending(blocked.map((item) => item.id));
    setBlocked([]);
    refreshPending();
  }, [blocked, refreshPending]);

  // Os ouvintes abaixo são registrados uma vez; chamam sempre a versão atual.
  const syncRef = useRef(sync);
  const refreshRef = useRef(refreshPending);
  useEffect(() => {
    syncRef.current = sync;
    refreshRef.current = refreshPending;
  });

  // Sessão confirmada (inclusive logo depois de um novo login): sobe o que
  // ficou na fila, sem esperar a conexão oscilar nem o toque do motorista.
  useEffect(() => {
    if (!userId) return;
    rememberOwner(userId);
    if (navigator.onLine) syncRef.current();
    else refreshRef.current();
  }, [userId]);

  useEffect(() => {
    refreshRef.current();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Falha ao registrar o service worker", error);
      });
    }

    // A conexão voltou: sobe o que ficou na fila.
    const handleOnline = () => {
      syncRef.current();
    };
    const handleQueued = () => {
      refreshRef.current();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("mello:baixa-enfileirada", handleQueued);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("mello:baixa-enfileirada", handleQueued);
    };
  }, []);

  const leave = () => {
    // Saída pedida pelo motorista: o próximo a entrar não herda o dono da fila.
    rememberOwner(null);
    sair();
  };

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative shadow-2xl overflow-hidden">
      <header className="bg-blue-600 text-white p-4 flex justify-between items-center z-10 shadow-md">
        <div className="flex items-center space-x-2">
          <Truck className="w-5 h-5" />
          <span className="font-outfit font-bold text-lg">Mello App</span>
        </div>
        <button
          onClick={leave}
          className="p-2 hover:bg-blue-700 rounded-full transition-colors"
          aria-label="Sair"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {!online && (
        <div className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center gap-2 z-10">
          <CloudOff className="w-4 h-4 shrink-0" />
          <span>Sem conexão. As baixas ficam salvas no aparelho e sobem sozinhas.</span>
        </div>
      )}

      {sessionExpired && pending > 0 && (
        <button
          onClick={leave}
          className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center gap-2 z-10 w-full text-left"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{SESSION_EXPIRED_MESSAGE} Toque aqui.</span>
        </button>
      )}

      {blocked.length > 0 && (
        <div role="alert" className="bg-red-50 text-red-800 px-4 py-2 text-sm flex items-start gap-2 z-10">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{blocked[0].reason}</p>
            <button onClick={discardBlocked} className="underline font-medium mt-1">
              Descartar {blocked.length === 1 ? "a baixa presa" : `as ${blocked.length} baixas presas`}
            </button>
          </div>
        </div>
      )}

      {othersPending > 0 && (
        <div className="bg-gray-100 text-gray-700 px-4 py-2 text-sm flex items-center gap-2 z-10">
          <CloudOff className="w-4 h-4 shrink-0" />
          <span>
            {othersPending === 1
              ? "Há 1 baixa de outro motorista neste aparelho. Ela sobe quando ele entrar."
              : `Há ${othersPending} baixas de outro motorista neste aparelho. Elas sobem quando ele entrar.`}
          </span>
        </div>
      )}

      {online && pending > 0 && (
        <button
          onClick={sync}
          className="bg-blue-50 text-blue-800 px-4 py-2 text-sm flex items-center gap-2 z-10 w-full text-left"
        >
          <RefreshCw className={`w-4 h-4 shrink-0 ${syncing ? "animate-spin" : ""}`} />
          <span>
            {pending} {pending === 1 ? "baixa pendente" : "baixas pendentes"},{" "}
            {syncing ? "enviando…" : "toque para enviar"}
          </span>
        </button>
      )}

      {feedback && (
        <div className="bg-emerald-50 text-emerald-800 px-4 py-2 text-sm flex items-center gap-2 z-10">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pb-20 relative">
        <div className="absolute top-0 left-0 w-full h-32 bg-blue-600 rounded-b-[40px] -z-0" />
        <div className="relative z-10 p-4">{children}</div>
      </main>

      <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-gray-200 px-6 py-3 flex justify-between items-center z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <Link
          href="/driver"
          className={`flex flex-col items-center p-2 transition-colors ${
            pathname === "/driver" || pathname.startsWith("/driver/viagem")
              ? "text-blue-600"
              : "text-gray-400"
          }`}
        >
          <Truck className="w-6 h-6 mb-1" />
          <span className="text-[10px] font-medium">Viagens</span>
        </Link>

        <Link
          href="/driver/mapa"
          className={`flex flex-col items-center p-2 transition-colors ${
            pathname === "/driver/mapa" ? "text-blue-600" : "text-gray-400"
          }`}
        >
          <Map className="w-6 h-6 mb-1" />
          <span className="text-[10px] font-medium">Rota</span>
        </Link>

        <Link
          href="/driver/perfil"
          className={`flex flex-col items-center p-2 transition-colors ${
            pathname === "/driver/perfil" ? "text-blue-600" : "text-gray-400"
          }`}
        >
          <User className="w-6 h-6 mb-1" />
          <span className="text-[10px] font-medium">Perfil</span>
        </Link>
      </nav>
    </div>
  );
}
