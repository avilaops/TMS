"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Truck, Map, User, LogOut, CloudOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { SESSION_EXPIRED_MESSAGE, countPending, flushQueue } from "@/lib/offline-queue";

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
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState("");
  // O servidor não reconheceu a sessão no reenvio: as baixas seguem no aparelho.
  const [sessionExpired, setSessionExpired] = useState(false);

  const refreshPending = useCallback(() => {
    countPending()
      .then(setPending)
      .catch(() => setPending(0));
  }, []);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await flushQueue();
      if (result.sent > 0) {
        setFeedback(
          `${result.sent} ${result.sent === 1 ? "baixa enviada" : "baixas enviadas"}.`
        );
      }
      if (result.rejected.length > 0) {
        setFeedback(`Recusado pelo servidor: ${result.rejected[0].reason}`);
      }
      setSessionExpired(result.needsLogin);
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [syncing, refreshPending]);

  useEffect(() => {
    refreshPending();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Falha ao registrar o service worker", error);
      });
    }

    // A conexão voltou: sobe o que ficou na fila.
    const handleOnline = () => {
      sync();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("mello:baixa-enfileirada", refreshPending);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("mello:baixa-enfileirada", refreshPending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          onClick={() => signOut({ callbackUrl: "/login" })}
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
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center gap-2 z-10 w-full text-left"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{SESSION_EXPIRED_MESSAGE} Toque aqui.</span>
        </button>
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
