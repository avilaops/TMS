"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal } from "lucide-react";
import {
  ACOES,
  ENTIDADES,
  linhasDoAntesEDepois,
  rotuloDaAcao,
  rotuloDaEntidade,
  type LinhaDeAuditoria,
} from "@/lib/auditoria";
import { AcessoRestrito } from "@/components/AcessoRestrito";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Auditoria: quem fez o quê, quando e de onde, da ação mais recente para a
 * mais antiga. A tela só lê (`/api/auditoria`); as linhas não podem ser
 * alteradas nem apagadas. Abrir uma linha mostra o antes e o depois, lado a lado.
 */

type Filtros = { de: string; ate: string; usuario: string; entidade: string; acao: string; id: string };
type Pagina = { registros: LinhaDeAuditoria[]; proximo: string | null };
type Carga = { denied: DeniedReason } | { denied: null; erro: string } | ({ denied: null; erro: null } & Pagina);
type Usuario = { id: string; name: string };

const SEM_FILTRO: Filtros = { de: "", ate: "", usuario: "", entidade: "", acao: "", id: "" };
const FALHA = "Não foi possível carregar a auditoria.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const CAMPO =
  "block w-full min-w-0 mt-0.5 px-3 py-1.5 md:py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm";
const ROTULO = "min-w-0 text-xs md:text-sm text-gray-500";
const COM_ROTULO =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const PERFIS: Record<string, string> = { ADMIN: "Administrador", OPERATION: "Operação", DRIVER: "Motorista", CLIENT: "Cliente" };

async function buscar(filtros: Filtros, cursor: string | null): Promise<Carga> {
  try {
    const query = new URLSearchParams();
    for (const [campo, valor] of Object.entries(filtros)) if (valor.trim()) query.set(campo, valor.trim());
    if (cursor) query.set("cursor", cursor);
    const res = await fetch(`/api/auditoria?${query}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(corpo?.registros)) {
      return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    }
    return { denied: null, erro: null, registros: corpo.registros, proximo: corpo.proximo ?? null };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function AuditoriaPage() {
  // `rascunho` é o que está nos campos; `filtros` é o que foi aplicado e está na lista.
  const [rascunho, setRascunho] = useState<Filtros>(SEM_FILTRO);
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [buscandoMais, setBuscandoMais] = useState(false);
  // No celular os filtros ficam recolhidos: a lista é a tarefa principal.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  useEffect(() => {
    let ativo = true;
    buscar(filtros, null).then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [filtros]);

  // A lista de usuários só serve ao filtro: se falhar, a tela segue sem ele.
  useEffect(() => {
    let ativo = true;
    fetch("/api/usuarios")
      .then((res) => (res.ok ? res.json() : []))
      .then((lista) => {
        if (ativo && Array.isArray(lista)) setUsuarios(lista.map((u: Usuario) => ({ id: u.id, name: u.name })));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  const aplicar = (novos: Filtros) => {
    setCarga(null);
    setAberta(null);
    setRascunho(novos);
    setFiltros(novos);
  };

  const carregarMais = async () => {
    if (!carga || carga.denied !== null || carga.erro !== null || !carga.proximo) return;
    setBuscandoMais(true);
    const mais = await buscar(filtros, carga.proximo);
    setBuscandoMais(false);
    if (mais.denied !== null || mais.erro !== null) {
      setCarga(mais);
      return;
    }
    setCarga({ denied: null, erro: null, registros: [...carga.registros, ...mais.registros], proximo: mais.proximo });
  };

  if (carga && carga.denied !== null) return <AcessoRestrito motivo={carga.denied} oQue="a auditoria" />;

  const filtrando = Object.values(filtros).some((valor) => valor !== "");
  const campo = (nome: keyof Filtros) => ({
    value: rascunho[nome],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setRascunho((atual) => ({ ...atual, [nome]: e.target.value })),
  });

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Auditoria</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Quem fez o quê, quando e de onde. As linhas não podem ser alteradas nem apagadas.</p>
        </div>
        <button
          type="button"
          onClick={() => setFiltrosAbertos((aberto) => !aberto)}
          aria-expanded={filtrosAbertos}
          className="md:hidden flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filtros{filtrando ? " •" : ""}
        </button>
      </div>

      <form
        aria-label="Filtros"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar(rascunho);
          setFiltrosAbertos(false);
        }}
        className={`${filtrosAbertos ? "grid" : "hidden"} md:grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6 md:gap-4 ${CARD} p-3 md:p-5`}
      >
        <label className={ROTULO}>
          De
          <input type="date" {...campo("de")} className={CAMPO} />
        </label>
        <label className={ROTULO}>
          Até
          <input type="date" {...campo("ate")} className={CAMPO} />
        </label>
        <label className={ROTULO}>
          Usuário
          <select {...campo("usuario")} className={CAMPO}>
            <option value="">Todos</option>
            {usuarios.map((usuario) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.name}
              </option>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          O quê
          <select {...campo("entidade")} className={CAMPO}>
            <option value="">Tudo</option>
            {Object.entries(ENTIDADES).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          Ação
          <select {...campo("acao")} className={CAMPO}>
            <option value="">Todas</option>
            {Object.entries(ACOES).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          Id do registro
          <input type="search" {...campo("id")} placeholder="Cole o id" className={CAMPO} />
        </label>
        <div className="col-span-2 md:col-span-6 flex justify-end gap-2">
          {filtrando && (
            <button type="button" onClick={() => aplicar(SEM_FILTRO)} className="min-h-10 px-4 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300">
              Limpar
            </button>
          )}
          <button type="submit" className="min-h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold">
            Filtrar
          </button>
        </div>
      </form>

      {!carga && (
        <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {carga && carga.denied === null && carga.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {carga.erro}
        </div>
      )}

      {carga && carga.denied === null && carga.erro === null && carga.registros.length === 0 && (
        <p className={`${CARD} px-4 py-10 text-center text-sm text-gray-500`}>
          {filtrando ? "Nenhuma ação com estes filtros." : "Nenhuma ação registrada ainda."}
        </p>
      )}

      {carga && carga.denied === null && carga.erro === null && carga.registros.length > 0 && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Quando</th>
                <th className="px-4 py-3 font-medium">Quem</th>
                <th className="px-4 py-3 font-medium">Ação</th>
                <th className="px-4 py-3 font-medium">O que aconteceu</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
              {carga.registros.map((linha) => {
                const estaAberta = aberta === linha.id;
                return (
                  <Fragment key={linha.id}>
                    <tr
                      data-linha={linha.id}
                      data-acao={linha.action}
                      onClick={() => setAberta(estaAberta ? null : linha.id)}
                      className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td data-rotulo="Quando" className={`min-w-0 md:table-cell md:px-4 md:py-3 whitespace-nowrap text-gray-600 dark:text-gray-300 ${COM_ROTULO}`}>
                        {dataHora(linha.createdAt)}
                      </td>
                      <td data-rotulo="Quem" className={`min-w-0 md:table-cell md:px-4 md:py-3 truncate ${COM_ROTULO}`}>
                        {linha.userName}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
                          {rotuloDaAcao(linha.action)}
                        </span>
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-gray-900 dark:text-white">{linha.summary}</td>
                      <td className="hidden md:table-cell md:px-4 md:py-3 text-right">
                        <button
                          type="button"
                          aria-expanded={estaAberta}
                          aria-label={estaAberta ? "Fechar detalhes" : "Ver detalhes"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAberta(estaAberta ? null : linha.id);
                          }}
                          className="p-1 text-gray-500"
                        >
                          {estaAberta ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                    {estaAberta && (
                      <tr className="block md:table-row bg-gray-50 dark:bg-gray-950" data-detalhe={linha.id}>
                        <td colSpan={5} className="block md:table-cell px-3 py-3 md:px-4 md:py-4">
                          <Detalhe linha={linha} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {carga.proximo && (
            <div className="p-3 border-t border-gray-100 dark:border-gray-800 text-center">
              <button
                type="button"
                onClick={carregarMais}
                disabled={buscandoMais}
                className="min-h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                {buscandoMais ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detalhe({ linha }: { linha: LinhaDeAuditoria }) {
  const campos = linhasDoAntesEDepois(linha.before, linha.after);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4 text-sm">
        <Item rotulo="Perfil" valor={linha.userRole ? (PERFIS[linha.userRole] ?? linha.userRole) : "-"} />
        <Item rotulo="Tipo" valor={rotuloDaEntidade(linha.entity)} />
        <Item rotulo="IP" valor={linha.ip ?? "não informado"} />
        <Item rotulo="Dispositivo" valor={linha.device ?? "não informado"} />
        {linha.entityId && <Item rotulo="Id do registro" valor={linha.entityId} largo mono />}
        {!linha.userId && <Item rotulo="Usuário" valor="Este usuário foi apagado depois da ação." largo />}
      </dl>

      {campos.length === 0 ? (
        <p className="text-sm text-gray-500">Esta ação não guarda antes e depois.</p>
      ) : (
        <table className="w-full text-sm" aria-label="Antes e depois">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="w-1/4 py-1 pr-2 text-xs font-medium">Campo</th>
              <th className="w-[37.5%] py-1 pr-2 text-xs font-medium">Antes</th>
              <th className="w-[37.5%] py-1 text-xs font-medium">Depois</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {campos.map((c) => (
              <tr key={c.campo} data-campo={c.campo}>
                <td className="py-1.5 pr-2 align-top text-gray-500">{c.rotulo}</td>
                <td className="py-1.5 pr-2 align-top break-words text-gray-600 dark:text-gray-300">{c.antes}</td>
                <td className="py-1.5 align-top break-words font-medium text-gray-900 dark:text-white">{c.depois}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Item({ rotulo, valor, largo = false, mono = false }: { rotulo: string; valor: string; largo?: boolean; mono?: boolean }) {
  return (
    <div className={`min-w-0 ${largo ? "col-span-2" : ""}`}>
      <dt className="text-[11px] leading-tight text-gray-500">{rotulo}</dt>
      <dd className={`break-all text-gray-900 dark:text-white ${mono ? "font-mono text-xs" : ""}`}>{valor}</dd>
    </div>
  );
}
