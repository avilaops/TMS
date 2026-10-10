"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";

/**
 * Uma aba da tela de frota do veículo: a lista de registros de um tipo
 * (abastecimentos, documentos, pneus…) e o formulário que cria ou altera um.
 * Cada aba só descreve os campos e as colunas; carregar, gravar, excluir e os
 * avisos são iguais em todas e ficam aqui.
 *
 * No celular a lista vira cartões e, com o formulário aberto, só ele aparece:
 * é o que cabe numa tela.
 */

export const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
export const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
export const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

const COM_ROTULO =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

/** Os valores do formulário, sempre como texto: quem converte e valida é a rota. */
export type Valores = Record<string, string>;

export const ITEM_OK = "ok";
export const ITEM_COM_PROBLEMA = "problema";

export type Campo = {
  chave: string;
  rotulo: string;
  /** `decimal` e `inteiro` são texto com o teclado numérico; `item` é um botão OK/Problema. */
  tipo?: "texto" | "data" | "decimal" | "inteiro" | "opcoes" | "item";
  /** Para `opcoes`: pares valor e rótulo. */
  opcoes?: readonly (readonly [string, string])[];
  obrigatorio?: boolean;
  /** Ocupa a linha inteira. */
  largo?: boolean;
  placeholder?: string;
};

export type Coluna<T> = {
  rotulo: string;
  valor: (item: T) => React.ReactNode;
  /** No celular, ocupa a linha inteira do cartão e dispensa o rótulo. */
  largo?: boolean;
  direita?: boolean;
};

type Props<T extends { id: string }> = {
  /** Endereço da coleção: `GET` lista, `POST` cria, `PATCH` e `DELETE` em `url/id`. */
  url: string;
  /** Rótulo do botão que abre o formulário: "Novo abastecimento". */
  novo: string;
  /** Aviso depois de gravar: "Abastecimento registrado." */
  salvo: string;
  /** Texto da lista vazia. */
  vazio: string;
  campos: readonly Campo[];
  formVazio: () => Valores;
  /** Monta o corpo do `POST` quando ele não é o formulário como está. */
  paraCorpo?: (form: Valores) => unknown;
  colunas: readonly Coluna<T>[];
  /** Presente quando o registro pode ser alterado: os campos que mudam e como preenchê-los. */
  editar?: { campos: readonly Campo[]; paraForm: (item: T) => Valores };
  /** Presente quando o registro pode ser excluído: a pergunta de confirmação. */
  excluir?: (item: T) => string;
  /** Linha de explicação embaixo do formulário. */
  nota?: string;
  formAberto: boolean;
  setFormAberto: (aberto: boolean) => void;
  onNegado: (motivo: DeniedReason) => void;
};

type Carga<T> = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; itens: T[] };

const FALHA_AO_CARREGAR = "Não foi possível carregar os registros.";
const FALHA_AO_GRAVAR = "Não foi possível gravar o registro.";

async function buscar<T>(url: string): Promise<Carga<T>> {
  try {
    const res = await fetch(url);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA_AO_CARREGAR };
    return { denied: null, erro: null, itens: corpo as T[] };
  } catch {
    return { denied: null, erro: FALHA_AO_CARREGAR };
  }
}

export function AbaDeRegistros<T extends { id: string }>({
  url,
  novo,
  salvo,
  vazio,
  campos,
  formVazio,
  paraCorpo,
  colunas,
  editar,
  excluir,
  nota,
  formAberto,
  setFormAberto,
  onNegado,
}: Props<T>) {
  const [itens, setItens] = useState<T[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Muda a cada gravação: é o que faz a lista ser lida de novo.
  const [versao, setVersao] = useState(0);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [form, setForm] = useState<Valores>(formVazio);
  const [editando, setEditando] = useState<T | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    buscar<T>(url).then((carga) => {
      if (!ativo) return;
      if (carga.denied !== null) return onNegado(carga.denied);
      setErro(carga.erro);
      if (carga.erro === null) setItens(carga.itens);
    });
    return () => {
      ativo = false;
    };
  }, [url, versao, onNegado]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(formVazio());
    setMensagem(null);
    setFormAberto(true);
  };

  const abrirEdicao = (item: T) => {
    if (!editar) return;
    setEditando(item);
    setForm(editar.paraForm(item));
    setMensagem(null);
    setFormAberto(true);
  };

  /** Trata a resposta de uma gravação; devolve true quando deu certo. */
  const conferir = async (res: Response, sucesso: string) => {
    const negado = deniedReason(res.status);
    if (negado) {
      setFormAberto(false);
      onNegado(negado);
      return false;
    }
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      setMensagem({ ok: false, texto: corpo.error ?? FALHA_AO_GRAVAR });
      return false;
    }
    setMensagem({ ok: true, texto: sucesso });
    setVersao((atual) => atual + 1);
    return true;
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setMensagem(null);
    try {
      // Na alteração vão só os campos que podem mudar.
      const corpo =
        editando && editar
          ? Object.fromEntries(editar.campos.map((campo) => [campo.chave, form[campo.chave] ?? ""]))
          : paraCorpo
            ? paraCorpo(form)
            : form;
      const res = await fetch(editando ? `${url}/${editando.id}` : url, {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (await conferir(res, editando ? "Registro alterado." : salvo)) setFormAberto(false);
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_GRAVAR });
    } finally {
      setOcupado(false);
    }
  };

  const apagar = async (item: T) => {
    if (!excluir || !window.confirm(excluir(item))) return;
    setOcupado(true);
    setMensagem(null);
    try {
      await conferir(await fetch(`${url}/${item.id}`, { method: "DELETE" }), "Registro excluído.");
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_GRAVAR });
    } finally {
      setOcupado(false);
    }
  };

  const camposDoForm = editando && editar ? editar.campos : campos;
  const temAcoes = Boolean(editar || excluir);

  return (
    <div className="space-y-3 md:space-y-4">
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-3`}>
        <p role="status" className={`min-w-0 text-sm ${mensagem?.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {!formAberto && mensagem?.texto}
        </p>
        <button
          type="button"
          onClick={abrirNovo}
          className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 md:px-4 md:py-2.5 text-sm rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{novo}</span>
        </button>
      </div>

      {formAberto && (
        <form onSubmit={salvar} className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{editando ? "Alterar registro" : novo}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-3">
            {camposDoForm.map((campo) => (
              <CampoDoForm key={campo.chave} campo={campo} valor={form[campo.chave] ?? ""} onChange={(valor) => setForm((atual) => ({ ...atual, [campo.chave]: valor }))} />
            ))}
          </div>
          {nota && !editando && <p className="text-xs text-gray-500">{nota}</p>}
          {mensagem && !mensagem.ok && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {mensagem.texto}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={ocupado}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2"
            >
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${formAberto ? "hidden md:block " : ""}${CARD} overflow-hidden`}>
        {erro !== null ? (
          <p role="alert" className="p-4 text-sm text-red-600">
            {erro}
          </p>
        ) : itens === null ? (
          <div className="flex items-center justify-center h-40" role="status" aria-label="Carregando">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : itens.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">{vazio}</p>
        ) : (
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
              <tr>
                {colunas.map((coluna) => (
                  <th key={coluna.rotulo} className={`px-4 py-3 font-medium ${coluna.direita ? "text-right" : ""}`}>
                    {coluna.rotulo}
                  </th>
                ))}
                {temAcoes && <th className="px-4 py-3 font-medium text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
              {itens.map((item) => (
                <tr key={item.id} data-registro={item.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                  {colunas.map((coluna) => (
                    <td
                      key={coluna.rotulo}
                      data-rotulo={coluna.rotulo}
                      className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-900 dark:text-white ${coluna.largo ? "col-span-2 font-medium" : COM_ROTULO} ${coluna.direita ? "md:text-right" : ""}`}
                    >
                      {coluna.valor(item)}
                    </td>
                  ))}
                  {temAcoes && (
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 md:text-right whitespace-nowrap space-x-4">
                      {editar && (
                        <button type="button" disabled={ocupado} onClick={() => abrirEdicao(item)} className="text-blue-600 hover:underline">
                          Editar
                        </button>
                      )}
                      {excluir && (
                        <button type="button" disabled={ocupado} onClick={() => void apagar(item)} className="text-red-600 hover:underline">
                          Excluir
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CampoDoForm({ campo, valor, onChange }: { campo: Campo; valor: string; onChange: (valor: string) => void }) {
  if (campo.tipo === "item") {
    const comProblema = valor === ITEM_COM_PROBLEMA;
    return (
      <button
        type="button"
        data-item={campo.chave}
        aria-pressed={comProblema}
        onClick={() => onChange(comProblema ? ITEM_OK : ITEM_COM_PROBLEMA)}
        className={`flex items-center justify-between gap-2 min-w-0 px-3 py-2 rounded-xl border text-sm ${
          comProblema
            ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
            : "border-green-200 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
        }`}
      >
        <span className="truncate font-medium">{campo.rotulo}</span>
        <span className="shrink-0 text-xs">{comProblema ? "Problema" : "OK"}</span>
      </button>
    );
  }

  return (
    <label className={`space-y-0.5 md:space-y-1.5 block min-w-0 ${campo.largo ? "col-span-2 lg:col-span-3" : ""}`}>
      <span className={LABEL}>{campo.rotulo}</span>
      {campo.tipo === "opcoes" ? (
        <select name={campo.chave} value={valor} required={campo.obrigatorio} onChange={(e) => onChange(e.target.value)} className={INPUT}>
          {(campo.opcoes ?? []).map(([opcao, rotulo]) => (
            <option key={opcao} value={opcao}>
              {rotulo}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={campo.chave}
          type={campo.tipo === "data" ? "date" : "text"}
          inputMode={campo.tipo === "decimal" ? "decimal" : campo.tipo === "inteiro" ? "numeric" : undefined}
          value={valor}
          required={campo.obrigatorio}
          placeholder={campo.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT}
        />
      )}
    </label>
  );
}
