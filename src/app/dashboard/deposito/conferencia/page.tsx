"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Pencil, ScanLine } from "lucide-react";
import { COLLECTION_STATUS, formatWeight, statusBadge } from "@/lib/format";
import { SITUACAO_DO_VOLUME, VOLUME_STATUSES, interpretarLeitura, type CargaConferida, type VolumeDaCarga, type VolumeStatus } from "@/lib/deposito";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, Negado, Situacao, erroDe } from "../comum";

/**
 * Recebimento e conferência por leitura, feita em pé, com o celular ou o
 * coletor. Um campo só, sempre com o foco: o leitor de código de barras é um
 * teclado que digita o código e aperta Enter.
 *
 * 1. Lê o código de rastreio da carga (ou a etiqueta de um volume dela): a
 *    carga abre com a lista dos volumes esperados.
 * 2. Cada etiqueta lida marca o volume como recebido; o botão "Conferir" faz o
 *    mesmo sem leitor. Em "Editar" ficam o peso, a avaria, o faltando e a posição.
 * 3. Ler o código de uma posição põe nela os volumes conferidos que ainda não
 *    têm lugar.
 * 4. "Concluir" grava a conferência e dá a carga como coletada.
 */

type Aviso = { tipo: "ok" | "erro" | "info"; texto: string };

type Resposta = CargaConferida & { sequenciaLida?: number | null; sequence?: number; repetido?: boolean; alocados?: number };

type Edicao = { sequence: number; status: VolumeStatus; weight: string; damageNote: string; locationCode: string; posicaoOriginal: string };

const FALHA = "Não foi possível falar com o servidor. Tente de novo.";
const NAO_E_CARGA = "Leia o código de rastreio da carga ou a etiqueta de um dos volumes dela.";

const COR_DO_AVISO: Record<Aviso["tipo"], string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  erro: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const enderecoDaBusca = (lido: string) => `/api/deposito/conferencia?codigo=${encodeURIComponent(lido)}`;

type Resultado = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; resposta: Resposta };

/** Chama a API e diz o que voltou: sessão ou perfil recusado, erro com o motivo, ou a resposta. */
async function pedir(url: string, init?: RequestInit): Promise<Resultado> {
  try {
    const res = await fetch(url, init);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, resposta: (await res.json()) as Resposta };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function ConferenciaPage() {
  const [denied, setDenied] = useState<DeniedReason | null>(null);
  const [codigo, setCodigo] = useState("");
  const [carga, setCarga] = useState<CargaConferida | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [posicoes, setPosicoes] = useState<string[]>([]);
  const campo = useRef<HTMLInputElement>(null);

  const focar = () => campo.current?.focus();

  /** Mostra a recusa ou o erro que a API devolveu; se deu certo, entrega a resposta. */
  const receber = useCallback((resultado: Resultado): Resposta | null => {
    if (resultado.denied !== null) {
      setDenied(resultado.denied);
      return null;
    }
    if (resultado.erro !== null) {
      setAviso({ tipo: "erro", texto: resultado.erro });
      return null;
    }
    return resultado.resposta;
  }, []);

  /** Chama a API e devolve a resposta, ou `null` depois de mostrar o erro. */
  const chamar = useCallback(async (url: string, init?: RequestInit) => receber(await pedir(url, init)), [receber]);

  const registrar = useCallback(
    async (id: string, dados: Record<string, unknown>) => {
      const resposta = await chamar(`/api/deposito/coletas/${id}/volumes`, json("POST", dados));
      if (!resposta) return null;
      setCarga(resposta);
      setAviso(
        resposta.repetido
          ? { tipo: "info", texto: `Volume ${resposta.sequence} já estava conferido.` }
          : { tipo: "ok", texto: `Volume ${resposta.sequence} de ${resposta.carga.volumes} conferido.` },
      );
      return resposta;
    },
    [chamar],
  );

  /** Põe na tela a carga achada pela leitura `lido`. */
  const mostrarCarga = useCallback(
    async (resposta: Resposta, lido: string) => {
      setCarga(resposta);
      if (resposta.recusa) return setAviso({ tipo: "erro", texto: resposta.recusa });
      setAviso(null);
      // Abriu pela etiqueta de um volume: aquele volume já fica conferido.
      if (resposta.sequenciaLida) await registrar(resposta.carga.id, { codigo: lido });
    },
    [registrar],
  );

  const abrir = async (lido: string) => {
    const resposta = await chamar(enderecoDaBusca(lido));
    if (resposta) await mostrarCarga(resposta, lido);
  };

  // A visão do depósito manda para cá com a carga já escolhida (`?codigo=`).
  useEffect(() => {
    const inicial = new URLSearchParams(window.location.search).get("codigo");
    if (!inicial) return;
    let ativo = true;
    pedir(enderecoDaBusca(inicial)).then((resultado) => {
      if (!ativo) return;
      const resposta = receber(resultado);
      if (resposta) void mostrarCarga(resposta, inicial);
    });
    return () => {
      ativo = false;
    };
  }, [receber, mostrarCarga]);

  const alocar = async (aberta: CargaConferida, locationCode: string) => {
    // Primeiro os que ainda não têm lugar; se todos já têm, a leitura muda a carga inteira de posição.
    const semPosicao = aberta.volumes.filter((v) => (v.status === "RECEIVED" || v.status === "DAMAGED") && !v.location).map((v) => v.sequence);
    const resposta = await chamar(
      `/api/deposito/coletas/${aberta.carga.id}/posicao`,
      json("POST", { locationCode, ...(semPosicao.length > 0 ? { sequences: semPosicao } : {}) }),
    );
    if (!resposta) return;
    setCarga(resposta);
    setAviso({ tipo: "ok", texto: `${resposta.alocados} volume(s) na posição ${locationCode}.` });
  };

  const ler = async (e: React.FormEvent) => {
    e.preventDefault();
    const lido = codigo.trim();
    if (!lido || ocupado) return;
    setCodigo("");
    setOcupado(true);
    try {
      const leitura = interpretarLeitura(lido);
      if (!carga || carga.recusa) {
        if (leitura.tipo === "CARGA" || leitura.tipo === "VOLUME") await abrir(lido);
        else setAviso({ tipo: "erro", texto: NAO_E_CARGA });
      } else if (leitura.tipo === "VOLUME") {
        await registrar(carga.carga.id, { codigo: lido });
      } else if (leitura.tipo === "POSICAO") {
        await alocar(carga, leitura.code);
      } else if (leitura.tipo === "CARGA" && leitura.trackingCode === carga.carga.trackingCode) {
        setAviso({ tipo: "info", texto: "Esta é a carga aberta. Leia a etiqueta de um volume." });
      } else if (leitura.tipo === "CARGA") {
        setAviso({ tipo: "erro", texto: "Este código é de outra carga. Conclua esta conferência ou troque de carga antes." });
      } else {
        setAviso({ tipo: "erro", texto: "Código não reconhecido. Leia a etiqueta de um volume ou o código de uma posição." });
      }
    } finally {
      setOcupado(false);
      focar();
    }
  };

  const conferir = async (volume: VolumeDaCarga) => {
    if (!carga || ocupado) return;
    setOcupado(true);
    await registrar(carga.carga.id, { sequence: volume.sequence });
    setOcupado(false);
    focar();
  };

  const editar = async (volume: VolumeDaCarga) => {
    const posicao = volume.location?.code ?? "";
    setEdicao({
      sequence: volume.sequence,
      status: volume.status === "PENDING" ? "RECEIVED" : volume.status,
      weight: volume.weight === null ? "" : String(volume.weight).replace(".", ","),
      damageNote: volume.damageNote ?? "",
      locationCode: posicao,
      posicaoOriginal: posicao,
    });
    // As posições ativas, para sugerir no campo, só são pedidas na primeira edição.
    if (posicoes.length > 0) return;
    const res = await fetch("/api/deposito/posicoes").catch(() => null);
    if (res?.ok) setPosicoes(((await res.json()) as { code: string; active: boolean }[]).filter((p) => p.active).map((p) => p.code));
  };

  const salvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carga || !edicao || ocupado) return;
    setOcupado(true);
    try {
      const { sequence, status, weight, damageNote, locationCode, posicaoOriginal } = edicao;
      const gravado = await registrar(carga.carga.id, { sequence, status, weight, damageNote: status === "DAMAGED" ? damageNote : "" });
      if (!gravado) return;

      // Volume faltando não tem posição; nos outros, só chama se o operador mexeu no campo.
      const posicao = locationCode.trim();
      if (status !== "MISSING" && posicao !== posicaoOriginal) {
        const alocado = await chamar(`/api/deposito/coletas/${carga.carga.id}/posicao`, json("POST", { locationCode: posicao, sequences: [sequence] }));
        if (!alocado) return;
        setCarga(alocado);
      }
      setAviso({ tipo: "ok", texto: `Volume ${sequence} gravado.` });
      setEdicao(null);
    } finally {
      setOcupado(false);
    }
  };

  const concluir = async () => {
    if (!carga || ocupado) return;
    const { pendentes } = carga.resumo;
    if (pendentes > 0 && !window.confirm(`${pendentes} volume(s) não foram lidos e vão ficar como faltando. Concluir mesmo assim?`)) return;
    setOcupado(true);
    const resposta = await chamar(`/api/deposito/coletas/${carga.carga.id}/concluir`, json("POST"));
    if (resposta) {
      setCarga(resposta);
      setAviso({ tipo: "ok", texto: "Conferência concluída. A carga está no depósito." });
    }
    setOcupado(false);
    focar();
  };

  const trocarDeCarga = () => {
    setCarga(null);
    setAviso(null);
    setEdicao(null);
    focar();
  };

  if (denied) return <Negado motivo={denied} />;

  const aberta = carga && !carga.recusa ? carga : null;
  const conferidos = carga ? carga.resumo.esperados - carga.resumo.pendentes : 0;
  // Com a edição de um volume aberta, o celular mostra só ela: cabe numa tela, sem rolar.
  const atrasDaEdicao = edicao ? "hidden md:block" : "";

  return (
    <div className="space-y-3 md:space-y-6 max-w-3xl">
      <div className={`${edicao ? "hidden md:flex" : "flex"} items-center justify-between gap-3`}>
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/dashboard/deposito" aria-label="Voltar para o depósito" className="p-2 -ml-2 text-gray-500 hover:text-gray-900 dark:hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white truncate">Conferência</h1>
        </div>
        {carga && (
          <button type="button" onClick={trocarDeCarga} className={`${BOTAO_CLARO} shrink-0`}>
            Trocar de carga
          </button>
        )}
      </div>

      <form onSubmit={ler} aria-label="Leitura" className={`flex gap-2 ${atrasDaEdicao}`}>
        <input
          ref={campo}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="send"
          aria-label={aberta ? "Etiqueta do volume ou código da posição" : "Código de rastreio da carga"}
          placeholder={aberta ? "Etiqueta do volume ou posição" : "Código de rastreio da carga"}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className={`${INPUT} py-3 text-base font-mono`}
        />
        <button type="submit" disabled={ocupado} className={`${BOTAO_AZUL} shrink-0 px-5`}>
          {ocupado ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanLine className="w-5 h-5" />}
          <span className="hidden md:inline">Ler</span>
        </button>
      </form>

      {aviso && (
        <p role={aviso.tipo === "erro" ? "alert" : "status"} data-aviso={aviso.tipo} className={`px-3 py-2 text-sm border rounded-xl ${COR_DO_AVISO[aviso.tipo]} ${atrasDaEdicao}`}>
          {aviso.texto}
        </p>
      )}

      {!carga && !aviso && (
        <p className="text-sm text-gray-500">
          Leia com o leitor, ou digite e aperte Enter, o código de rastreio da carga que chegou. Vale também a etiqueta de qualquer volume dela.
        </p>
      )}

      {carga && (
        <section aria-label="Carga" className={`${CARD} px-3 py-2.5 md:p-5 ${atrasDaEdicao}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white truncate">{carga.carga.cliente}</p>
              <p className="text-xs md:text-sm text-gray-500 truncate">
                {carga.carga.receiver} · {carga.carga.destination}
              </p>
              <p className="font-mono text-xs text-gray-500">{carga.carga.trackingCode ?? "sem código"}</p>
            </div>
            <div className="shrink-0 text-right">
              <p data-progresso className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                {conferidos} de {carga.resumo.esperados}
              </p>
              <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap ${statusBadge(COLLECTION_STATUS, carga.carga.status).className}`}>
                {statusBadge(COLLECTION_STATUS, carga.carga.status).label}
              </span>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300">
            <span>Declarado: {formatWeight(carga.carga.weight)}</span>
            <span>Conferido: {carga.resumo.pesoConferido === null ? "não pesado" : formatWeight(carga.resumo.pesoConferido)}</span>
            {carga.resumo.avariados > 0 && <span className="text-amber-700">{carga.resumo.avariados} avariado(s)</span>}
            {carga.resumo.faltando > 0 && <span className="text-red-600">{carga.resumo.faltando} faltando</span>}
            {carga.resumo.divergenciaDePeso && <span className="text-red-600">peso diverge do declarado</span>}
            {carga.conferencia && <span className="text-emerald-700">conferência concluída</span>}
          </div>
        </section>
      )}

      {aberta && edicao && (
        <form onSubmit={salvarEdicao} aria-label={`Volume ${edicao.sequence}`} className={`${CARD} p-3 md:p-5 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Volume {edicao.sequence} de {aberta.carga.volumes}
          </h2>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Situação">
            {VOLUME_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={edicao.status === status}
                onClick={() => setEdicao({ ...edicao, status })}
                className={`px-2 py-3 rounded-xl border text-sm font-medium ${
                  edicao.status === status ? "border-blue-500 ring-2 ring-blue-500 text-blue-700 dark:text-blue-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                {SITUACAO_DO_VOLUME[status]}
              </button>
            ))}
          </div>
          {edicao.status !== "MISSING" && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
              <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
                <span className={LABEL}>Peso conferido (kg)</span>
                <input inputMode="decimal" placeholder="Opcional" value={edicao.weight} onChange={(e) => setEdicao({ ...edicao, weight: e.target.value })} className={INPUT} />
              </label>
              <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
                <span className={LABEL}>Posição</span>
                <input
                  list="posicoes-do-deposito"
                  autoCapitalize="characters"
                  placeholder="Ex.: A-01-03"
                  value={edicao.locationCode}
                  onChange={(e) => setEdicao({ ...edicao, locationCode: e.target.value })}
                  className={`${INPUT} font-mono`}
                />
                <datalist id="posicoes-do-deposito">
                  {posicoes.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </label>
              {edicao.status === "DAMAGED" && (
                <label className="col-span-2 block space-y-0.5 md:space-y-1.5 min-w-0">
                  <span className={LABEL}>O que há de errado</span>
                  <textarea required rows={2} maxLength={500} value={edicao.damageNote} onChange={(e) => setEdicao({ ...edicao, damageNote: e.target.value })} className={INPUT} />
                </label>
              )}
            </div>
          )}
          {aviso?.tipo === "erro" && (
            <p role="alert" className="md:hidden text-sm text-red-600 dark:text-red-400">
              {aviso.texto}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:flex md:justify-end">
            <button type="button" onClick={() => setEdicao(null)} className={BOTAO_CLARO}>
              Cancelar
            </button>
            <button type="submit" disabled={ocupado} className={BOTAO_AZUL}>
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Gravar volume
            </button>
          </div>
        </form>
      )}

      {aberta && (
        <div className={`space-y-3 ${atrasDaEdicao}`}>
          <ul aria-label="Volumes" className={`${CARD} divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden`}>
            {aberta.volumes.map((volume) => (
              <li key={volume.sequence} data-volume={volume.sequence} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Volume {volume.sequence} <Situacao situacao={volume.status} />
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    <span className="font-mono">{volume.code}</span>
                    {volume.weight !== null && ` · ${formatWeight(volume.weight)}`}
                    {volume.location && ` · ${volume.location.code}`}
                    {volume.damageNote && ` · ${volume.damageNote}`}
                  </p>
                </div>
                {(volume.status === "PENDING" || volume.status === "MISSING") && (
                  <button type="button" disabled={ocupado} onClick={() => void conferir(volume)} className={`${BOTAO_AZUL} shrink-0 px-3`}>
                    <Check className="w-4 h-4" />
                    Conferir
                  </button>
                )}
                <button type="button" disabled={ocupado} onClick={() => void editar(volume)} aria-label={`Editar volume ${volume.sequence}`} className={`${BOTAO_CLARO} shrink-0 px-3`}>
                  <Pencil className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            <Link href={`/dashboard/deposito/etiquetas/${aberta.carga.id}`} className={`${BOTAO_CLARO} py-3`}>
              Etiquetas
            </Link>
            <button type="button" disabled={ocupado || conferidos === 0} onClick={() => void concluir()} className={`${BOTAO_AZUL} py-3`}>
              {aberta.conferencia ? "Concluir de novo" : "Concluir"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
