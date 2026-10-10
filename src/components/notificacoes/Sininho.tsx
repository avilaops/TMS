"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, BellOff, BellRing, CheckCheck, X } from "lucide-react";
import { INTERVALO_DO_SININHO_MS, contadorDoSininho, haQuantoTempo, type AvisoDaLista, type PaginaDeAvisos } from "@/lib/notificacoes";
import {
  ERRO_AO_ATIVAR,
  MENSAGEM_DO_PUSH,
  type AmbienteDoPush,
  type Area,
  ambienteDoPush,
  ativarPush,
  conferirPush,
  desligarPush,
  situacaoDoPush,
} from "@/lib/push-cliente";

/**
 * O sininho: os avisos de quem está logado, no painel, no portal do cliente e
 * no app do motorista.
 *
 * `Avisos` vai uma vez em volta da área: é ele que consulta o servidor (ao
 * abrir a tela, a cada minuto e ao abrir a lista), guarda os avisos e desenha
 * a lista. `Sininho` é só o botão com o contador, e pode aparecer em mais de
 * um lugar da mesma tela (cabeçalho do celular e do computador) sem repetir a
 * consulta.
 *
 * A lista abre por cima da tela, presa ao topo, e cabe numa tela de celular: o
 * que rola é só a lista, o cabeçalho e o botão das notificações ficam à vista.
 */

type Contexto = { naoLidos: number; aberto: boolean; alternar: () => void };

const AvisosContexto = createContext<Contexto | null>(null);

// Onde a lista aparece no computador. No celular ela fica sempre sob o cabeçalho.
const NO_COMPUTADOR: Record<Area, string> = {
  dashboard: "md:left-auto md:right-8 md:mx-0 md:w-96",
  portal: "md:left-[17rem] md:right-auto md:top-4 md:mx-0 md:w-96",
  driver: "",
};

// O painel e o portal viram app na Tela de Início (é o que o iPhone exige para
// receber push). O app do motorista já declara o dele (src/app/driver/layout.tsx).
const MANIFESTO: Partial<Record<Area, string>> = { dashboard: "/painel.webmanifest", portal: "/portal.webmanifest" };

const SEM_AMBIENTE: AmbienteDoPush = { suporte: false, iphone: false, instalado: false, permissao: "default" };

async function lerJson<T>(res: Response): Promise<T | null> {
  return res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

export function Avisos({ area, children }: { area: Area; children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const userId = status === "authenticated" ? (session?.user?.id ?? null) : null;

  const [avisos, setAvisos] = useState<AvisoDaLista[]>([]);
  const [naoLidos, setNaoLidos] = useState(0);
  const [proximo, setProximo] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");

  // Push neste aparelho.
  const [chave, setChave] = useState<string | null>(null);
  const [ambiente, setAmbiente] = useState<AmbienteDoPush>(SEM_AMBIENTE);
  const [inscrito, setInscrito] = useState(false);
  const [pushConferido, setPushConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  /** A primeira página e o contador. Falha de rede ou sessão vencida não muda a tela. */
  const carregar = useCallback(async () => {
    try {
      const pagina = await lerJson<PaginaDeAvisos>(await fetch("/api/notificacoes"));
      if (!pagina) return;
      setAvisos(pagina.avisos);
      setNaoLidos(pagina.naoLidos);
      setProximo(pagina.proximo);
    } catch {
      // Sem rede (o app do motorista roda offline): fica o que já estava na tela.
    }
  }, []);

  // Os temporizadores e ouvintes chamam sempre a versão atual.
  const carregarRef = useRef(carregar);
  useEffect(() => {
    carregarRef.current = carregar;
  });

  // Ao abrir a tela e a cada minuto, enquanto a aba está à vista.
  useEffect(() => {
    if (!userId) return;
    carregarRef.current();
    const relogio = setInterval(() => {
      if (document.visibilityState !== "hidden") carregarRef.current();
    }, INTERVALO_DO_SININHO_MS);
    return () => clearInterval(relogio);
  }, [userId]);

  // O push deste aparelho: a chave do servidor e se quem está logado já ativou aqui.
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    (async () => {
      const lido = ambienteDoPush();
      let daChave: string | null = null;
      let ativo = false;
      try {
        daChave = (await lerJson<{ chave: string | null }>(await fetch("/api/notificacoes/chave")))?.chave ?? null;
        if (daChave && lido.suporte) ativo = await conferirPush(area, userId);
      } catch {
        // Sem rede: o botão aparece quando der para conferir.
      }
      if (!vivo) return;
      setAmbiente(lido);
      setChave(daChave);
      setInscrito(ativo);
      setPushConferido(true);
    })();
    return () => {
      vivo = false;
    };
  }, [area, userId]);

  const alternar = useCallback(() => {
    setErro("");
    setAberto((estava) => !estava);
  }, []);
  const fechar = useCallback(() => setAberto(false), []);

  // Ao abrir a lista: consulta de novo. Esc fecha.
  useEffect(() => {
    if (!aberto) return;
    carregarRef.current();
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  const marcar = useCallback(async (corpo: { ids: string[] } | { todas: true }) => {
    try {
      const res = await fetch("/api/notificacoes/lidas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const lido = await lerJson<{ naoLidos: number }>(res);
      if (lido) setNaoLidos(lido.naoLidos);
    } catch {
      // A próxima consulta acerta o contador.
    }
  }, []);

  /** Tocar no aviso: marca como lido e fecha; quem leva ao endereço é o próprio link. */
  const abrirAviso = (aviso: AvisoDaLista) => {
    setAberto(false);
    if (aviso.readAt) return;
    const agora = new Date().toISOString();
    setAvisos((lista) => lista.map((outro) => (outro.id === aviso.id ? { ...outro, readAt: agora } : outro)));
    setNaoLidos((n) => Math.max(0, n - 1));
    marcar({ ids: [aviso.id] });
  };

  const marcarTodos = () => {
    const agora = new Date().toISOString();
    setAvisos((lista) => lista.map((aviso) => (aviso.readAt ? aviso : { ...aviso, readAt: agora })));
    setNaoLidos(0);
    marcar({ todas: true });
  };

  const verMais = async () => {
    if (!proximo) return;
    try {
      const pagina = await lerJson<PaginaDeAvisos>(await fetch(`/api/notificacoes?cursor=${encodeURIComponent(proximo)}`));
      if (!pagina) return;
      setAvisos((lista) => [...lista, ...pagina.avisos.filter((novo) => !lista.some((aviso) => aviso.id === novo.id))]);
      setProximo(pagina.proximo);
    } catch {
      setErro("Não foi possível carregar os avisos mais antigos.");
    }
  };

  const situacao = pushConferido ? situacaoDoPush(ambiente, chave, inscrito) : "carregando";

  /** Só no toque da pessoa: é aqui que o navegador pergunta se ela permite. */
  const ativar = async () => {
    if (!userId || !chave || ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      await ativarPush(area, chave, userId);
      setInscrito(true);
    } catch (falha) {
      setErro(falha instanceof Error && falha.message ? falha.message : ERRO_AO_ATIVAR);
    } finally {
      setAmbiente(ambienteDoPush());
      setOcupado(false);
    }
  };

  const desligar = async () => {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      await desligarPush(area);
      setInscrito(false);
    } catch {
      setErro("Não foi possível desligar as notificações neste aparelho. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const contexto = useMemo(() => ({ naoLidos, aberto, alternar }), [naoLidos, aberto, alternar]);
  const manifesto = MANIFESTO[area];

  return (
    <AvisosContexto.Provider value={contexto}>
      {manifesto && <link rel="manifest" href={manifesto} />}
      {children}
      {aberto &&
        createPortal(
          <>
            <div data-avisos-fundo className="fixed inset-0 z-[60] bg-black/30 md:bg-transparent" onClick={fechar} aria-hidden="true" />
            <section
              role="dialog"
              aria-label="Avisos"
              className={`fixed z-[61] inset-x-2 top-[4.5rem] mx-auto max-w-md max-h-[calc(100dvh-5.5rem)] flex flex-col rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 ${NO_COMPUTADOR[area]}`}
            >
              <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="flex-1 font-outfit font-bold text-base">Avisos</h2>
                {naoLidos > 0 && (
                  <button type="button" onClick={marcarTodos} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                    <CheckCheck className="w-4 h-4" />
                    Marcar tudo como lido
                  </button>
                )}
                <button type="button" onClick={fechar} aria-label="Fechar avisos" className="p-1 -mr-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="w-5 h-5" />
                </button>
              </header>

              <ul data-avisos className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                {avisos.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">Nenhum aviso por enquanto.</li>}
                {avisos.map((aviso) => (
                  <li key={aviso.id}>
                    <Link
                      href={aviso.url}
                      onClick={() => abrirAviso(aviso)}
                      data-lido={aviso.readAt ? "sim" : "nao"}
                      className="flex gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${aviso.readAt ? "bg-transparent" : "bg-blue-600"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm truncate ${aviso.readAt ? "font-medium" : "font-semibold"}`}>{aviso.title}</span>
                          <span className="shrink-0 text-[11px] text-gray-500">{haQuantoTempo(aviso.createdAt)}</span>
                        </span>
                        <span className="block text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{aviso.body}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {proximo && (
                  <li>
                    <button type="button" onClick={verMais} className="w-full px-4 py-2.5 text-sm font-medium text-blue-600 hover:bg-gray-50 dark:text-blue-400 dark:hover:bg-gray-800">
                      Ver avisos mais antigos
                    </button>
                  </li>
                )}
              </ul>

              {(erro || (situacao !== "carregando" && situacao !== "desligado")) && (
                <footer className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-sm">
                  {erro && (
                    <p role="alert" className="mb-2 text-red-600 dark:text-red-400">
                      {erro}
                    </p>
                  )}
                  {situacao === "inativo" && (
                    <button
                      type="button"
                      onClick={ativar}
                      disabled={ocupado}
                      className="w-full flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
                    >
                      <BellRing className="w-4 h-4" />
                      {ocupado ? "Ativando…" : "Ativar notificações neste aparelho"}
                    </button>
                  )}
                  {situacao === "ativo" && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        <BellRing className="w-4 h-4 shrink-0 text-emerald-600" />
                        Notificações ativas neste aparelho.
                      </p>
                      <button type="button" onClick={desligar} disabled={ocupado} className="shrink-0 flex items-center gap-1 font-medium text-gray-700 hover:underline disabled:opacity-60 dark:text-gray-300">
                        <BellOff className="w-4 h-4" />
                        Desligar
                      </button>
                    </div>
                  )}
                  {MENSAGEM_DO_PUSH[situacao] && <p className="text-gray-600 dark:text-gray-400">{MENSAGEM_DO_PUSH[situacao]}</p>}
                </footer>
              )}
            </section>
          </>,
          document.body,
        )}
    </AvisosContexto.Provider>
  );
}

const BOTAO_PADRAO =
  "w-10 h-10 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-center text-gray-500 hover:text-blue-600 transition-colors";

/** O botão do sininho, com o número de avisos não lidos. Fora de `Avisos` não desenha nada. */
export function Sininho({ className = BOTAO_PADRAO }: { className?: string }) {
  const avisos = useContext(AvisosContexto);
  if (!avisos) return null;

  const contador = contadorDoSininho(avisos.naoLidos);
  return (
    <button
      type="button"
      data-sininho
      onClick={avisos.alternar}
      aria-expanded={avisos.aberto}
      aria-label={contador ? `Avisos: ${avisos.naoLidos} não ${avisos.naoLidos === 1 ? "lido" : "lidos"}` : "Avisos"}
      className={`relative ${className}`}
    >
      <Bell className="w-5 h-5" />
      {contador && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none flex items-center justify-center">
          {contador}
        </span>
      )}
    </button>
  );
}
