"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, List, Loader2, Map as IconeDeMapa, MapPin, Route, Trash2 } from "lucide-react";
import { COLLECTION_STATUS, MANIFEST_STATUS, formatCalendarDate, formatCurrency, formatDate, statusBadge } from "@/lib/format";
import { diaNoBrasil } from "@/lib/financeiro";
import { acertoPorExtenso, nomeDaPessoa, rotuloDoMotivo, type Acerto } from "@/lib/equipe";
import {
  EXPENSE_STATUS,
  EXPENSE_TYPES,
  EXPENSE_TYPE_LABEL,
  codigoDaViagem,
  kmRodados,
  linkDaRota,
  moverParada,
  paraCampoDeDataHora,
  rotuloDaDespesa,
  type AcertoDaViagem,
} from "@/lib/viagem";
import { AVISO_DO_TRANSITO, avisoDaDistancia, type RespostaDoRoteiro } from "@/lib/roteiro";
import { enderecoCompleto } from "@/lib/endereco";
import type { MapaDaViagem } from "@/lib/mapa";
import { MapaDaViagemNaTela } from "@/components/mapa/mapa-da-viagem";
import type { Manifesto } from "./carregar";

/**
 * A tela da viagem, aberta a partir do cartão do manifesto: dados (ajudante,
 * hodômetro, previsões), ordem das entregas com a rota no mapa, despesas e, para
 * quem lê o financeiro, o acerto da viagem finalizada. Uma aba por vez, para caber
 * na tela do celular.
 */

const CAMPO =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const ROTULO = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const BOTAO = "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center justify-center gap-2";

type Aba = "Dados" | "Rota" | "Despesas" | "Acerto";

type Ajudante = { id: string; name: string; active: boolean };

type Despesa = {
  id: string;
  type: string;
  amount: number;
  date: string;
  notes: string | null;
  status: string;
  liters: number | null;
  odometer: number | null;
  fuelingId: string | null;
  createdBy: { name: string; role: string } | null;
};

type Adiantamento = {
  id: string;
  date: string;
  amount: number;
  reason: string;
  status: string;
  driver: { user: { name: string } } | null;
  helper: { name: string } | null;
};

type RespostaDoAcerto = {
  viagem: { finalizadaEm: string | null; saiuEm: string | null };
  acerto: AcertoDaViagem;
  saldoDoAdiantamento: Acerto | null;
  adiantamentos: Adiantamento[];
};

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  const corpo = await res.json().catch(() => null);
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

const json = (method: string, corpo?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

export function TelaDaViagem({
  manifesto,
  veAcerto,
  aprovaDespesa,
  alteraViagem = true,
  onClose,
  onChange,
}: {
  manifesto: Manifesto;
  /** O perfil lê o financeiro: a aba Acerto aparece na viagem finalizada. */
  veAcerto: boolean;
  /** O perfil lança no financeiro: aprova e recusa despesa. */
  aprovaDespesa: boolean;
  /** O perfil altera a viagem (capacidade `manifestos`): o botão "Sugerir ordem" aparece. */
  alteraViagem?: boolean;
  onClose: () => void;
  /** Algo da viagem mudou no servidor: a lista de manifestos precisa ser lida de novo. */
  onChange: () => void;
}) {
  const [aba, setAba] = useState<Aba>("Dados");
  const abas: Aba[] = ["Dados", "Rota", "Despesas", ...(veAcerto && manifesto.status === "FINISHED" ? (["Acerto"] as const) : [])];
  const selo = statusBadge(MANIFEST_STATUS, manifesto.status);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-label={`Viagem #${codigoDaViagem(manifesto.id)}`}
        className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-3xl md:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800"
      >
        <div className="px-3 py-2 md:px-6 md:py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white truncate">
              Viagem #{codigoDaViagem(manifesto.id)}
            </h2>
            <p className="text-xs text-gray-500 truncate">
              {manifesto.driver?.user?.name} · {manifesto.vehicle?.plate}
            </p>
          </div>
          <span className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full border ${selo.className}`}>{selo.label}</span>
          <button onClick={onClose} aria-label="Fechar" className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            ✕
          </button>
        </div>

        <div role="tablist" aria-label="Seção da viagem" className="grid gap-1 p-1 mx-3 mt-2 md:mx-6 bg-gray-100 dark:bg-gray-800 rounded-xl" style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}>
          {abas.map((nome) => (
            <button
              key={nome}
              type="button"
              role="tab"
              aria-selected={aba === nome}
              data-aba={nome}
              onClick={() => setAba(nome)}
              className={`py-1.5 rounded-lg text-sm font-semibold ${aba === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
            >
              {nome}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-6">
          {aba === "Dados" && <Dados manifesto={manifesto} onChange={onChange} />}
          {aba === "Rota" && <Rota manifesto={manifesto} podeSugerir={alteraViagem} onChange={onChange} />}
          {aba === "Despesas" && <Despesas manifesto={manifesto} admin={aprovaDespesa} />}
          {aba === "Acerto" && <AcertoDaViagemFinalizada manifestId={manifesto.id} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------ Dados ----------------------------------- */

function Dados({ manifesto, onChange }: { manifesto: Manifesto; onChange: () => void }) {
  const [form, setForm] = useState({
    helperId: manifesto.helper?.id ?? "",
    departureOdometer: manifesto.departureOdometer?.toString() ?? "",
    returnOdometer: manifesto.returnOdometer?.toString() ?? "",
    plannedDepartureAt: paraCampoDeDataHora(manifesto.plannedDepartureAt),
    plannedReturnAt: paraCampoDeDataHora(manifesto.plannedReturnAt),
    notes: manifesto.notes ?? "",
  });
  const [ajudantes, setAjudantes] = useState<Ajudante[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);
  const travada = manifesto.status === "CANCELLED";

  // A lista de ajudantes é só para o campo: se a leitura falhar, o campo fica com o que já estava.
  useEffect(() => {
    let ativo = true;
    fetch("/api/equipe/ajudantes")
      .then((res) => (res.ok ? res.json() : []))
      .then((lista: Ajudante[]) => {
        if (ativo) setAjudantes(lista);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  const mudar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAviso(null);
    setForm((atual) => ({ ...atual, [campo]: e.target.value }));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/dados`, json("PATCH", form));
      if (res.ok) {
        setAviso({ erro: false, texto: "Dados da viagem gravados." });
        onChange();
      } else {
        setAviso({ erro: true, texto: await mensagemDeErro(res, "Erro ao gravar os dados da viagem.") });
      }
    } catch {
      setAviso({ erro: true, texto: "Erro ao gravar os dados da viagem." });
    } finally {
      setOcupado(false);
    }
  };

  const km = kmRodados(form.departureOdometer === "" ? null : Number(form.departureOdometer), form.returnOdometer === "" ? null : Number(form.returnOdometer));
  // O ajudante da viagem continua na lista mesmo se foi desativado depois.
  const opcoes = ajudantes.filter((ajudante) => ajudante.active || ajudante.id === form.helperId);

  return (
    <form onSubmit={salvar} className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
      <label className="col-span-2 block min-w-0 space-y-0.5">
        <span className={ROTULO}>Ajudante</span>
        <select name="helperId" value={form.helperId} onChange={mudar("helperId")} disabled={travada} className={CAMPO}>
          <option value="">Sem ajudante</option>
          {manifesto.helper && !opcoes.some((ajudante) => ajudante.id === manifesto.helper?.id) && (
            <option value={manifesto.helper.id}>{manifesto.helper.name}</option>
          )}
          {opcoes.map((ajudante) => (
            <option key={ajudante.id} value={ajudante.id}>
              {ajudante.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0 space-y-0.5">
        <span className={ROTULO}>Km na saída</span>
        <input name="departureOdometer" inputMode="numeric" value={form.departureOdometer} onChange={mudar("departureOdometer")} disabled={travada} className={CAMPO} />
      </label>
      <label className="block min-w-0 space-y-0.5">
        <span className={ROTULO}>Km no retorno</span>
        <input name="returnOdometer" inputMode="numeric" value={form.returnOdometer} onChange={mudar("returnOdometer")} disabled={travada} className={CAMPO} />
      </label>
      <label className="block min-w-0 space-y-0.5">
        <span className={ROTULO}>Previsão de saída</span>
        <input name="plannedDepartureAt" type="datetime-local" value={form.plannedDepartureAt} onChange={mudar("plannedDepartureAt")} disabled={travada} className={CAMPO} />
      </label>
      <label className="block min-w-0 space-y-0.5">
        <span className={ROTULO}>Previsão de retorno</span>
        <input name="plannedReturnAt" type="datetime-local" value={form.plannedReturnAt} onChange={mudar("plannedReturnAt")} disabled={travada} className={CAMPO} />
      </label>
      <label className="col-span-2 block min-w-0 space-y-0.5">
        <span className={ROTULO}>Observação</span>
        <input name="notes" value={form.notes} onChange={mudar("notes")} disabled={travada} maxLength={1000} className={CAMPO} />
      </label>

      <p className="col-span-2 text-xs text-gray-500" data-km-rodados>
        Km rodados: <span className="font-semibold text-gray-900 dark:text-white">{km === null ? "-" : `${km.toLocaleString("pt-BR")} km`}</span>
        {manifesto.departedAt ? ` · Saiu em ${formatDate(manifesto.departedAt)}` : ""}
        {manifesto.finishedAt ? ` · Finalizada em ${formatDate(manifesto.finishedAt)}` : ""}
      </p>

      {aviso && (
        <p role={aviso.erro ? "alert" : "status"} className={`col-span-2 text-sm ${aviso.erro ? "text-red-600" : "text-emerald-700"}`}>
          {aviso.texto}
        </p>
      )}

      {!travada && (
        <div className="col-span-2 flex justify-end">
          <button type="submit" disabled={ocupado} className={BOTAO}>
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar dados
          </button>
        </div>
      )}
    </form>
  );
}

/* ------------------------------------ Rota ------------------------------------ */

function Rota({ manifesto, podeSugerir, onChange }: { manifesto: Manifesto; podeSugerir: boolean; onChange: () => void }) {
  // A ordem na tela; cada troca vai para o servidor na hora.
  const [ordem, setOrdem] = useState(() => manifesto.collections.map((carga) => carga.id));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  // A ordem sugerida, enquanto a pessoa decide se aplica: nada é gravado até o "Aplicar".
  const [sugestao, setSugestao] = useState<RespostaDoRoteiro | null>(null);
  // Lista ou mapa: um de cada vez, para a aba caber na tela do celular.
  const [ver, setVer] = useState<"lista" | "mapa">("lista");
  const [mapa, setMapa] = useState<MapaDaViagem | null>(null);
  const [erroDoMapa, setErroDoMapa] = useState("");
  const ordenavel = manifesto.status === "ASSEMBLING" || manifesto.status === "ROUTE";

  const porId = new Map(manifesto.collections.map((carga) => [carga.id, carga]));
  const cargas = ordem.flatMap((id) => porId.get(id) ?? []);
  // No mapa só o que falta entregar; com tudo entregue, a rota inteira.
  const aEntregar = cargas.filter((carga) => carga.status !== "DELIVERED");
  // Com endereço na carga o link leva o endereço inteiro; sem ele, a cidade, como antes.
  const link = linkDaRota((aEntregar.length > 0 ? aEntregar : cargas).map((carga) => enderecoCompleto(carga, carga.destination)));

  // O mapa é lido ao abrir (e relido a cada mudança da ordem) e, com a viagem em rota,
  // de novo a cada 30 segundos, que é o passo em que a posição do motorista chega.
  const chaveDaOrdem = ordem.join();
  useEffect(() => {
    if (ver !== "mapa") return;
    let vivo = true;
    const ler = async () => {
      try {
        const res = await fetch(`/api/manifestos/${manifesto.id}/mapa`);
        if (!vivo) return;
        if (res.ok) {
          setMapa((await res.json()) as MapaDaViagem);
          setErroDoMapa("");
        } else {
          setErroDoMapa(await mensagemDeErro(res, "Erro ao carregar o mapa da viagem."));
        }
      } catch {
        if (vivo) setErroDoMapa("Erro ao carregar o mapa da viagem.");
      }
    };
    void ler();
    const relogio = manifesto.status === "ROUTE" ? setInterval(() => void ler(), 30_000) : null;
    return () => {
      vivo = false;
      if (relogio) clearInterval(relogio);
    };
  }, [ver, manifesto.id, manifesto.status, chaveDaOrdem]);

  const mover = async (id: string, sentido: "subir" | "descer") => {
    const nova = moverParada(ordem, id, sentido);
    if (nova.join() === ordem.join()) return;
    const anterior = ordem;
    setOrdem(nova);
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/ordem`, json("PUT", { collectionIds: nova }));
      if (res.ok) {
        onChange();
      } else {
        setOrdem(anterior);
        setErro(await mensagemDeErro(res, "Erro ao gravar a ordem das entregas."));
      }
    } catch {
      setOrdem(anterior);
      setErro("Erro ao gravar a ordem das entregas.");
    } finally {
      setOcupado(false);
    }
  };

  // Pede a ordem sugerida ao servidor (é lá que está a tabela das cidades). Só calcula.
  const sugerir = async (voltar: boolean) => {
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/roteiro`, json("POST", { voltar }));
      if (res.ok) setSugestao((await res.json()) as RespostaDoRoteiro);
      else setErro(await mensagemDeErro(res, "Erro ao sugerir a ordem das entregas."));
    } catch {
      setErro("Erro ao sugerir a ordem das entregas.");
    } finally {
      setOcupado(false);
    }
  };

  // Grava a ordem sugerida pela mesma rota da ordem manual (que confere a lista e registra na auditoria).
  const aplicar = async () => {
    if (!sugestao) return;
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/manifestos/${manifesto.id}/ordem`, json("PUT", { collectionIds: sugestao.ordem }));
      if (res.ok) {
        setOrdem(sugestao.ordem);
        setSugestao(null);
        onChange();
      } else {
        setErro(await mensagemDeErro(res, "Erro ao gravar a ordem das entregas."));
      }
    } catch {
      setErro("Erro ao gravar a ordem das entregas.");
    } finally {
      setOcupado(false);
    }
  };

  if (cargas.length === 0) return <p className="text-sm text-gray-500">Esta viagem não tem carga.</p>;

  if (sugestao) {
    const km = (valor: number) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
    const semLocal = new Set(sugestao.naoLocalizadas);
    return (
      <div className="space-y-2" data-sugestao-de-ordem>
        <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm text-gray-900 dark:text-white">
          <p className="font-semibold" data-distancias>
            {sugestao.mudou ? (
              <>
                {km(sugestao.distanciaAntesKm)} hoje → {km(sugestao.distanciaDepoisKm)} na ordem sugerida
              </>
            ) : (
              <>A ordem atual já é a mais curta que a conta achou: {km(sugestao.distanciaAntesKm)}</>
            )}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300" data-medida={sugestao.medida}>
            Distância {avisoDaDistancia(sugestao.medida)}.{" "}
            {sugestao.origem ? `Saindo de ${sugestao.origem}.` : "A origem não foi localizada: a conta começa na primeira entrega."}{" "}
            {sugestao.porEndereco > 0 && `${sugestao.porEndereco === 1 ? "1 entrega entrou" : `${sugestao.porEndereco} entregas entraram`} pelo endereço. `}
            {AVISO_DO_TRANSITO}
          </p>
          <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={sugestao.voltar} disabled={ocupado} onChange={(e) => sugerir(e.target.checked)} />
            Contar a volta à origem
          </label>
        </div>
        {semLocal.size > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-sem-localizacao>
            {semLocal.size === 1 ? "1 entrega sem localização ficou" : `${semLocal.size} entregas sem localização ficaram`} no fim: nem o endereço nem a cidade do
            destino foram localizados.
          </p>
        )}
        {erro && (
          <p role="alert" className="text-sm text-red-600">
            {erro}
          </p>
        )}

        <ol className="space-y-1">
          {sugestao.ordem.flatMap((id, posicao) => {
            const carga = porId.get(id);
            if (!carga) return [];
            return (
              <li key={id} data-parada-sugerida={id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 rounded-xl px-3 py-1.5">
                <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">
                  {posicao + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{carga.receiver}</p>
                  <p className={`text-xs truncate ${semLocal.has(id) ? "text-amber-700 dark:text-amber-400" : "text-gray-500"}`}>
                    {sugestao.cidades[id] ?? `${carga.destination} · sem localização`}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">era {ordem.indexOf(id) + 1}</span>
              </li>
            );
          })}
        </ol>

        <div className="flex justify-end gap-2">
          <button type="button" disabled={ocupado} onClick={() => setSugestao(null)} className="border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-4 py-2 rounded-xl">
            Cancelar
          </button>
          <button type="button" disabled={ocupado || !sugestao.mudou} onClick={aplicar} className={BOTAO}>
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
            Aplicar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* No celular a frase fica em cima e os dois botões embaixo, lado a lado. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="w-full md:w-auto md:flex-1 text-xs text-gray-500">
          {ordenavel ? "A ordem das entregas é a que o motorista vê." : "Ordem em que as entregas foram feitas na viagem."}
        </p>
        {ordenavel && podeSugerir && cargas.length > 1 && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => sugerir(true)}
            data-sugerir-ordem
            className="shrink-0 flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 text-sm font-medium text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-xl disabled:opacity-50"
          >
            <Route className="w-4 h-4" /> Sugerir ordem
          </button>
        )}
        <button
          type="button"
          onClick={() => setVer(ver === "mapa" ? "lista" : "mapa")}
          aria-pressed={ver === "mapa"}
          data-ver-mapa
          className="shrink-0 flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 text-sm font-medium text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-xl"
        >
          {ver === "mapa" ? <List className="w-4 h-4" /> : <IconeDeMapa className="w-4 h-4" />} {ver === "mapa" ? "Lista" : "Mapa"}
        </button>
        {link.url && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            data-rota-no-mapa
            className="shrink-0 flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 text-sm font-medium text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-xl"
          >
            <MapPin className="w-4 h-4" /> Google Maps
          </a>
        )}
      </div>
      {link.deFora > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          O mapa leva as {link.incluidas} primeiras paradas; {link.deFora} {link.deFora === 1 ? "ficou" : "ficaram"} de fora do link.
        </p>
      )}
      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      {ver === "mapa" ? (
        <div data-aba-do-mapa className="space-y-1">
          {erroDoMapa && (
            <p role="alert" className="text-sm text-red-600">
              {erroDoMapa}
            </p>
          )}
          {mapa ? (
            <MapaDaViagemNaTela mapa={mapa} className="h-[46vh] md:h-80" />
          ) : (
            !erroDoMapa && <p className="text-sm text-gray-500">Carregando o mapa…</p>
          )}
          {mapa && !mapa.localizaEndereco && (
            <p data-sem-geo className="text-[11px] text-amber-700 dark:text-amber-400">
              A localização por endereço está desligada neste servidor (falta a variável GEO_CONTATO): as paradas aparecem no centro da cidade.
            </p>
          )}
        </div>
      ) : (
        <ol className="space-y-1.5">
          {cargas.map((carga, posicao) => {
            const seloCarga = statusBadge(COLLECTION_STATUS, carga.status);
            return (
              <li key={carga.id} data-parada={carga.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 rounded-xl px-3 py-2">
                <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">
                  {posicao + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{carga.receiver}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {enderecoCompleto(carga, carga.destination)} · {carga.client?.tradeName || carga.client?.companyName}
                  </p>
                </div>
                <span className={`hidden md:inline shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full border ${seloCarga.className}`}>{seloCarga.label}</span>
                {ordenavel && (
                  <div className="shrink-0 flex gap-1">
                    <button
                      type="button"
                      aria-label={`Subir a entrega ${posicao + 1}`}
                      disabled={ocupado || posicao === 0}
                      onClick={() => mover(carga.id, "subir")}
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Descer a entrega ${posicao + 1}`}
                      disabled={ocupado || posicao === cargas.length - 1}
                      onClick={() => mover(carga.id, "descer")}
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ---------------------------------- Despesas ---------------------------------- */

const DESPESA_EM_BRANCO = { type: "TOLL", amount: "", date: "", notes: "", liters: "", odometer: "" };

function Despesas({ manifesto, admin }: { manifesto: Manifesto; admin: boolean }) {
  const [lista, setLista] = useState<{ despesas: Despesa[]; total: number } | null>(null);
  const [form, setForm] = useState(() => ({ ...DESPESA_EM_BRANCO, date: diaNoBrasil(new Date()) }));
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const base = `/api/manifestos/${manifesto.id}/despesas`;
  const travada = manifesto.status === "CANCELLED";

  const ler = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) setLista(await res.json());
      else setErro(await mensagemDeErro(res, "Não foi possível carregar as despesas."));
    } catch {
      setErro("Não foi possível carregar as despesas.");
    }
  }, [base]);

  useEffect(() => {
    let ativo = true;
    fetch(base)
      .then(async (res) => {
        if (!ativo) return;
        if (res.ok) setLista(await res.json());
        else setErro(await mensagemDeErro(res, "Não foi possível carregar as despesas."));
      })
      .catch(() => {
        if (ativo) setErro("Não foi possível carregar as despesas.");
      });
    return () => {
      ativo = false;
    };
  }, [base]);

  const mudar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((atual) => ({ ...atual, [campo]: e.target.value }));

  // Lançar, aprovar, recusar e excluir: uma chamada, e a lista é lida de novo.
  const chamar = async (chave: string, url: string, init: RequestInit, falha: string) => {
    setOcupado(chave);
    setErro("");
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        setErro(await mensagemDeErro(res, falha));
        return false;
      }
      await ler();
      return true;
    } catch {
      setErro(falha);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const lancar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await chamar("nova", base, json("POST", form), "Erro ao lançar a despesa.")) {
      setForm((atual) => ({ ...DESPESA_EM_BRANCO, type: atual.type, date: atual.date }));
    }
  };

  const conferir = (despesa: Despesa, corpo: Record<string, unknown>) =>
    chamar(despesa.id, `${base}/${despesa.id}`, json("PATCH", corpo), "Erro ao conferir a despesa.");

  const excluir = (despesa: Despesa) => {
    if (!confirm(`Excluir ${rotuloDaDespesa(despesa.type).toLowerCase()} de ${formatCurrency(despesa.amount)}?`)) return;
    return chamar(despesa.id, `${base}/${despesa.id}`, { method: "DELETE" }, "Erro ao excluir a despesa.");
  };

  return (
    <div className="space-y-3">
      {!travada && (
        <form onSubmit={lancar} className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4 md:gap-3">
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>Tipo</span>
            <select name="type" value={form.type} onChange={mudar("type")} className={CAMPO}>
              {EXPENSE_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {EXPENSE_TYPE_LABEL[tipo]}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>Valor (R$)</span>
            <input name="amount" inputMode="decimal" required value={form.amount} onChange={mudar("amount")} className={CAMPO} />
          </label>
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>Data</span>
            <input name="date" type="date" required value={form.date} onChange={mudar("date")} className={CAMPO} />
          </label>
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>{form.type === "FUEL" ? "Posto" : "Observação"}</span>
            <input name="notes" value={form.notes} onChange={mudar("notes")} maxLength={500} className={CAMPO} />
          </label>
          {form.type === "FUEL" && (
            <>
              <label className="block min-w-0 space-y-0.5">
                <span className={ROTULO}>Litros</span>
                <input name="liters" inputMode="decimal" value={form.liters} onChange={mudar("liters")} className={CAMPO} />
              </label>
              <label className="block min-w-0 space-y-0.5">
                <span className={ROTULO}>Hodômetro (km)</span>
                <input name="odometer" inputMode="numeric" value={form.odometer} onChange={mudar("odometer")} className={CAMPO} />
              </label>
              <p className="col-span-2 text-xs text-gray-500 md:self-end">Com litros e hodômetro, o abastecimento entra também na frota do veículo.</p>
            </>
          )}
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button type="submit" disabled={ocupado !== null} className={BOTAO}>
              {ocupado === "nova" && <Loader2 className="w-4 h-4 animate-spin" />}
              Lançar despesa
            </button>
          </div>
        </form>
      )}

      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      {!lista ? (
        !erro && (
          <div className="flex justify-center py-6" role="status" aria-label="Carregando">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        )
      ) : lista.despesas.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma despesa lançada nesta viagem.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300" data-total-das-despesas>
            Total lançado: <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(lista.total)}</span>
          </p>
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Despesa</th>
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Valor</th>
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
              {lista.despesas.map((despesa) => {
                const seloDespesa = EXPENSE_STATUS[despesa.status] ?? { label: despesa.status, className: "" };
                const pendente = despesa.status === "PENDING";
                return (
                  <tr key={despesa.id} data-despesa={despesa.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-1 py-2.5 md:table-row">
                    <td className="min-w-0 md:table-cell md:px-4 md:py-3">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{rotuloDaDespesa(despesa.type)}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {despesa.createdBy?.name ?? "Usuário removido"}
                        {despesa.notes ? ` · ${despesa.notes}` : ""}
                        {despesa.fuelingId ? " · abastecimento na frota" : ""}
                      </p>
                    </td>
                    <td data-rotulo="Data" className="min-w-0 md:table-cell md:px-4 md:py-3 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none">
                      {formatCalendarDate(despesa.date)}
                    </td>
                    <td data-rotulo="Valor" className="min-w-0 md:table-cell md:px-4 md:py-3 font-semibold before:content-[attr(data-rotulo)] before:block before:text-[11px] before:font-normal before:text-gray-500 md:before:content-none">
                      {formatCurrency(despesa.amount)}
                    </td>
                    <td className="min-w-0 md:table-cell md:px-4 md:py-3">
                      <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border ${seloDespesa.className}`}>{seloDespesa.label}</span>
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      {pendente && (
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          {admin && (
                            <>
                              <button type="button" disabled={ocupado !== null} onClick={() => conferir(despesa, { action: "aprovar" })} className="text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1 disabled:opacity-50">
                                Aprovar a pagar
                              </button>
                              <button type="button" disabled={ocupado !== null} onClick={() => conferir(despesa, { action: "aprovar", paid: true })} className="text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1 disabled:opacity-50">
                                Aprovar paga
                              </button>
                              <button type="button" disabled={ocupado !== null} onClick={() => conferir(despesa, { action: "recusar" })} className="text-xs font-medium text-red-600 border border-red-200 rounded-lg px-2 py-1 disabled:opacity-50">
                                Recusar
                              </button>
                            </>
                          )}
                          <button type="button" aria-label="Excluir despesa" disabled={ocupado !== null} onClick={() => excluir(despesa)} className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!admin && <p className="text-xs text-gray-500">Aprovar a despesa (ela vira lançamento no Financeiro) é do Administrador.</p>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------ Acerto ---------------------------------- */

function AcertoDaViagemFinalizada({ manifestId }: { manifestId: string }) {
  const [estado, setEstado] = useState<{ erro: string } | RespostaDoAcerto | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/manifestos/${manifestId}/acerto`)
      .then(async (res) => {
        if (!ativo) return;
        if (res.ok) setEstado(await res.json());
        else if (res.status === 403) setEstado({ erro: "Seu perfil não tem acesso ao acerto da viagem." });
        else setEstado({ erro: await mensagemDeErro(res, "Não foi possível carregar o acerto.") });
      })
      .catch(() => {
        if (ativo) setEstado({ erro: "Não foi possível carregar o acerto." });
      });
    return () => {
      ativo = false;
    };
  }, [manifestId]);

  if (!estado) {
    return (
      <div className="flex justify-center py-6" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }
  if ("erro" in estado) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {estado.erro}
      </p>
    );
  }

  const { acerto, adiantamentos, saldoDoAdiantamento } = estado;
  const linhas: [string, string][] = [
    ["Frete das cargas", formatCurrency(acerto.frete)],
    ["Despesas aprovadas", formatCurrency(acerto.despesas)],
    ["Combustível (frota)", formatCurrency(acerto.combustivel)],
    ["Custo total", formatCurrency(acerto.custoTotal)],
    ["Km rodados", acerto.km === null ? "-" : `${acerto.km.toLocaleString("pt-BR")} km`],
    ["Custo por km", acerto.custoPorKm === null ? "-" : formatCurrency(acerto.custoPorKm)],
  ];

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border px-4 py-3 ${acerto.resultado < 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`} data-resultado-da-viagem>
        <p className="text-xs text-gray-600">Resultado da viagem</p>
        <p className={`text-2xl font-bold ${acerto.resultado < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCurrency(acerto.resultado)}</p>
        <p className="text-xs text-gray-600">Margem: {acerto.margem === null ? "-" : `${acerto.margem.toLocaleString("pt-BR")}%`}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} data-linha={rotulo}>
            <dt className="text-[11px] md:text-xs text-gray-500">{rotulo}</dt>
            <dd className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">{valor}</dd>
          </div>
        ))}
      </dl>

      {acerto.cargasACotar > 0 && (
        <p className="text-xs text-amber-700">
          {acerto.cargasACotar} {acerto.cargasACotar === 1 ? "carga está" : "cargas estão"} sem valor de frete: o frete acima está incompleto.
        </p>
      )}
      {acerto.pendentes.quantidade > 0 && (
        <p className="text-xs text-amber-700">
          {acerto.pendentes.quantidade} {acerto.pendentes.quantidade === 1 ? "despesa pendente" : "despesas pendentes"} ({formatCurrency(acerto.pendentes.total)}) ainda fora do custo. Aprove ou recuse na aba Despesas.
        </p>
      )}

      {acerto.despesasPorTipo.length > 0 && (
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {acerto.despesasPorTipo.map((linha) => `${rotuloDaDespesa(linha.type)} ${formatCurrency(linha.total)}`).join(" · ")}
        </p>
      )}

      <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Adiantamentos da viagem</h3>
        {adiantamentos.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum adiantamento ligado a esta viagem.</p>
        ) : (
          <>
            <ul className="mt-1 space-y-1">
              {adiantamentos.map((adiantamento) => (
                <li key={adiantamento.id} className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                    {nomeDaPessoa(adiantamento)} · {rotuloDoMotivo(adiantamento.reason)} · {formatCalendarDate(adiantamento.date)}
                  </span>
                  <span className="shrink-0 font-medium">{formatCurrency(adiantamento.amount)}</span>
                </li>
              ))}
            </ul>
            {saldoDoAdiantamento && (
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300" data-saldo-do-adiantamento>
                Adiantado {formatCurrency(acerto.adiantado)} contra {formatCurrency(acerto.despesas)} de despesas aprovadas:{" "}
                <span className="font-semibold">{acertoPorExtenso(saldoDoAdiantamento, formatCurrency)}</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
