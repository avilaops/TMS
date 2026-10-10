"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { formatCalendarDate, formatDocument } from "@/lib/format";
import { rotuloDaAusencia } from "@/lib/equipe";
import { BOTAO, CARD, COM_ROTULO, INPUT, LABEL, Mensagem, TABELA, TBODY, TD, TH, THEAD, TR, enviar, erroDe, type Aviso, type PessoaDaEquipe } from "./comum";

/**
 * Pessoas: motoristas e ajudantes numa lista só, com quem está ausente hoje.
 * O motorista é cadastrado em Motoristas (ele tem login e CNH); aqui se
 * cadastra o ajudante, que é só nome, CPF e telefone.
 */

const FORM_VAZIO = { name: "", cpf: "", phone: "" };

export function Pessoas({ pessoas, recarregar }: { pessoas: PessoaDaEquipe[]; recarregar: () => Promise<void> }) {
  const [formAberto, setFormAberto] = useState(false);
  // `null` = ajudante novo; com id, o formulário altera aquele ajudante.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const abrirNovo = () => {
    setEditandoId(null);
    setForm(FORM_VAZIO);
    setAviso(null);
    setFormAberto(true);
  };

  const abrirEdicao = (pessoa: PessoaDaEquipe) => {
    setEditandoId(pessoa.id);
    setForm({ name: pessoa.nome, cpf: pessoa.cpf, phone: pessoa.telefone ?? "" });
    setAviso(null);
    setFormAberto(true);
  };

  const gravar = async (res: Response, sucesso: string, falha: string) => {
    if (!res.ok) {
      setAviso({ ok: false, texto: await erroDe(res, falha) });
      return false;
    }
    setAviso({ ok: true, texto: sucesso });
    await recarregar();
    return true;
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setAviso(null);
    try {
      // Na edição o CPF não muda.
      const res = editandoId
        ? await enviar(`/api/equipe/ajudantes/${editandoId}`, "PATCH", { name: form.name, phone: form.phone })
        : await enviar("/api/equipe/ajudantes", "POST", form);
      if (await gravar(res, editandoId ? "Ajudante alterado." : "Ajudante cadastrado.", "Erro ao salvar o ajudante.")) setFormAberto(false);
    } catch {
      setAviso({ ok: false, texto: "Erro ao salvar o ajudante." });
    } finally {
      setOcupado(false);
    }
  };

  const alternar = async (pessoa: PessoaDaEquipe) => {
    if (pessoa.ativo && !window.confirm(`Desativar ${pessoa.nome}? Ele deixa de aparecer para novas ausências e adiantamentos.`)) return;
    setOcupado(true);
    setAviso(null);
    try {
      const res = await enviar(`/api/equipe/ajudantes/${pessoa.id}`, "PATCH", { active: !pessoa.ativo });
      await gravar(res, pessoa.ativo ? "Ajudante desativado." : "Ajudante reativado.", "Erro ao alterar o ajudante.");
    } finally {
      setOcupado(false);
    }
  };

  const ausentes = pessoas.filter((pessoa) => pessoa.ativo && pessoa.ausencia).length;

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Com o formulário aberto, o celular fica só com ele: é o que cabe numa tela. */}
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-2`}>
        <p className="text-sm text-gray-600 dark:text-gray-300" data-resumo="ausentes">
          {ausentes === 0 ? "Ninguém ausente hoje." : `${ausentes} ${ausentes === 1 ? "pessoa ausente" : "pessoas ausentes"} hoje.`}
        </p>
        <button type="button" onClick={abrirNovo} className={BOTAO}>
          <Plus className="w-4 h-4" />
          Novo ajudante
        </button>
      </div>

      <Mensagem aviso={aviso} />

      {formAberto && (
        <form onSubmit={salvar} aria-label="Ajudante" className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{editandoId ? "Alterar ajudante" : "Novo ajudante"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-3">
            <label className="col-span-2 lg:col-span-1 space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Nome</span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>CPF</span>
              <input
                required
                inputMode="numeric"
                disabled={editandoId !== null}
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                className={`${INPUT} disabled:bg-gray-100 dark:disabled:bg-gray-800`}
              />
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Telefone</span>
              <input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={INPUT} />
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={ocupado} className={BOTAO}>
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${formAberto ? "hidden md:block " : ""}${CARD} overflow-hidden`}>
        {pessoas.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">Nenhum motorista ou ajudante cadastrado.</p>
        ) : (
          <table className={TABELA}>
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Nome</th>
                <th className={TH}>Função</th>
                <th className={TH}>CPF</th>
                <th className={TH}>Telefone</th>
                <th className={TH}>Hoje</th>
                <th className={`${TH} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {pessoas.map((pessoa) => (
                <tr key={pessoa.chave} data-pessoa={pessoa.chave} className={TR}>
                  <td className={`${TD} font-medium text-gray-900 dark:text-white`}>{pessoa.nome}</td>
                  <td className={`${TD} text-gray-600 dark:text-gray-300 capitalize`}>{pessoa.tipo}</td>
                  <td data-rotulo="CPF" className={`${TD} ${COM_ROTULO} text-gray-600 dark:text-gray-300`}>{formatDocument(pessoa.cpf)}</td>
                  <td data-rotulo="Telefone" className={`${TD} ${COM_ROTULO} text-gray-600 dark:text-gray-300`}>{pessoa.telefone || "-"}</td>
                  <td className={TD}>
                    {!pessoa.ativo ? (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Inativo</span>
                    ) : pessoa.ausencia ? (
                      <span data-situacao="ausente" className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                        {rotuloDaAusencia(pessoa.ausencia.type)} até {formatCalendarDate(pessoa.ausencia.endDate)}
                      </span>
                    ) : (
                      <span data-situacao="disponivel" className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                        Disponível
                      </span>
                    )}
                  </td>
                  <td className={`${TD} md:text-right whitespace-nowrap space-x-3`}>
                    {pessoa.tipo === "motorista" ? (
                      <Link href="/dashboard/motoristas" className="text-blue-600 hover:underline">
                        Cadastro
                      </Link>
                    ) : (
                      <>
                        <button type="button" disabled={ocupado} onClick={() => abrirEdicao(pessoa)} className="text-blue-600 hover:underline">
                          Editar
                        </button>
                        <button type="button" disabled={ocupado} onClick={() => void alternar(pessoa)} className={pessoa.ativo ? "text-red-600 hover:underline" : "text-blue-600 hover:underline"}>
                          {pessoa.ativo ? "Desativar" : "Reativar"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
