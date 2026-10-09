"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Receipt } from "lucide-react";
import { formatCalendarDate, formatCurrency, formatDate, formatWeight } from "@/lib/format";

/**
 * Faturamento: escolhe um cliente com cargas entregues, marca as que entram e
 * emite a fatura. Abaixo, as faturas emitidas, com pagar, reabrir e cancelar.
 * Só o administrador chega aqui (a API recusa os demais).
 */

type Resumo = { clientId: string; cliente: string; cargas: number; total: number };

type Carga = {
  id: string;
  trackingCode: string | null;
  createdAt: string;
  origin: string;
  destination: string;
  receiver: string;
  volumes: number;
  weight: number;
  freightValue: number | null;
};

type Fatura = {
  id: string;
  number: number;
  status: "OPEN" | "PAID" | "CANCELLED";
  total: number;
  dueDate: string;
  issuedAt: string;
  client: { companyName: string; tradeName: string | null };
  _count: { collections: number };
};

const STATUS: Record<Fatura["status"], { rotulo: string; classe: string }> = {
  OPEN: { rotulo: "Em aberto", classe: "bg-yellow-100 text-yellow-800" },
  PAID: { rotulo: "Paga", classe: "bg-green-100 text-green-700" },
  CANCELLED: { rotulo: "Cancelada", classe: "bg-gray-100 text-gray-600" },
};

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const INPUT =
  "px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";

// Vencimento sugerido: 15 dias a partir de hoje.
const daquiA15Dias = () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export default function Faturamento() {
  const [negado, setNegado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [resumo, setResumo] = useState<Resumo[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  const [clienteId, setClienteId] = useState("");
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [aCotar, setACotar] = useState<Carga[]>([]);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [vencimento, setVencimento] = useState(daquiA15Dias);
  const [observacao, setObservacao] = useState("");
  const [fretes, setFretes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);

  const carregar = async () => {
    try {
      const [r, f] = await Promise.all([fetch("/api/faturas/faturaveis"), fetch("/api/faturas")]);
      if (r.status === 401 || r.status === 403) return setNegado(true);
      if (r.ok) setResumo(await r.json());
      if (f.ok) setFaturas(await f.json());
    } finally {
      setCarregando(false);
    }
  };

  const abrirCliente = async (id: string) => {
    setClienteId(id);
    setMensagem(null);
    if (!id) {
      setCargas([]);
      setACotar([]);
      setMarcadas(new Set());
      return;
    }
    const res = await fetch(`/api/faturas/faturaveis?clientId=${encodeURIComponent(id)}`);
    if (!res.ok) return setMensagem({ ok: false, texto: "Não foi possível carregar as cargas do cliente." });
    const dados = (await res.json()) as { cargas: Carga[]; aCotar: Carga[] };
    setCargas(dados.cargas);
    setACotar(dados.aCotar);
    setMarcadas(new Set(dados.cargas.map((c) => c.id)));
  };

  useEffect(() => {
    void carregar();
  }, []);

  const erroDe = async (res: Response, padrao: string) =>
    ((await res.json().catch(() => ({}))) as { error?: string }).error ?? padrao;

  const total = cargas.filter((c) => marcadas.has(c.id)).reduce((soma, c) => soma + (c.freightValue ?? 0), 0);

  const alternar = (id: string) =>
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });

  const emitir = async () => {
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/faturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clienteId, collectionIds: [...marcadas], dueDate: vencimento, notes: observacao }),
      });
      if (res.ok) {
        const fatura = (await res.json()) as Fatura;
        setMensagem({ ok: true, texto: `Fatura nº ${fatura.number} emitida: ${formatCurrency(fatura.total)}.` });
        setObservacao("");
        await carregar();
        await abrirCliente(clienteId);
      } else {
        setMensagem({ ok: false, texto: await erroDe(res, "Erro ao emitir a fatura.") });
      }
    } catch {
      setMensagem({ ok: false, texto: "Erro ao emitir a fatura." });
    } finally {
      setOcupado(false);
    }
  };

  const informarFrete = async (id: string) => {
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch(`/api/coletas/${id}/frete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freightValue: fretes[id] ?? "" }),
      });
      if (res.ok) {
        await carregar();
        await abrirCliente(clienteId);
      } else {
        setMensagem({ ok: false, texto: await erroDe(res, "Erro ao informar o frete.") });
      }
    } finally {
      setOcupado(false);
    }
  };

  const agir = async (fatura: Fatura, action: "pagar" | "reabrir" | "cancelar") => {
    if (
      action === "cancelar" &&
      !window.confirm(`Cancelar a fatura nº ${fatura.number}? As cargas voltam a ficar disponíveis para faturar e o número não é reaproveitado.`)
    ) {
      return;
    }
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch(`/api/faturas/${fatura.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) setMensagem({ ok: false, texto: await erroDe(res, "Erro ao alterar a fatura.") });
      await carregar();
      if (clienteId) await abrirCliente(clienteId);
    } finally {
      setOcupado(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (negado) {
    return (
      <div className={`${CARD} p-8`}>
        <h1 className="font-outfit font-bold text-lg">Acesso negado</h1>
        <p className="text-sm text-gray-500 mt-1">O faturamento é restrito ao perfil Administrador.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Faturamento</h1>
        <p className="text-gray-500 text-sm mt-1">Fature o frete das cargas entregues e acompanhe o recebimento</p>
      </div>

      {mensagem && (
        <p role="status" className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      <div className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-5`}>
        <h2 className="font-semibold text-gray-900 dark:text-white">Nova fatura</h2>

        {resumo.length === 0 && !clienteId ? (
          <p className="text-sm text-gray-500">
            Nenhuma carga pronta para faturar. Entra aqui a carga entregue, com frete definido e que ainda não foi faturada.
          </p>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Cliente</span>
            <select value={clienteId} onChange={(e) => void abrirCliente(e.target.value)} className={`${INPUT} w-full sm:w-96`}>
              <option value="">Escolha o cliente</option>
              {resumo.map((r) => (
                <option key={r.clientId} value={r.clientId}>
                  {r.cliente} · {r.cargas} carga(s) · {formatCurrency(r.total)}
                </option>
              ))}
            </select>
          </label>
        )}

        {clienteId && cargas.length > 0 && (
          <>
            <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 w-10" />
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Trajeto</th>
                    <th className="px-4 py-3 font-medium">Destinatário</th>
                    <th className="px-4 py-3 font-medium">Volumes / Peso</th>
                    <th className="px-4 py-3 font-medium text-right">Frete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {cargas.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Incluir a carga ${c.trackingCode ?? c.id}`}
                          checked={marcadas.has(c.id)}
                          onChange={() => alternar(c.id)}
                        />
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{formatDate(c.createdAt)}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white">
                        {c.origin} → {c.destination}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{c.receiver}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {c.volumes} · {formatWeight(c.weight)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900 dark:text-white">{formatCurrency(c.freightValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
                <span className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Vencimento</span>
                <input type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={INPUT} />
              </label>
              <label className="space-y-1.5 block flex-1 min-w-[12rem]">
                <span className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Observação (opcional)</span>
                <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${INPUT} w-full`} />
              </label>
              <div className="text-right">
                <p className="text-xs text-gray-500">{marcadas.size} carga(s)</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(total)}</p>
              </div>
              <button
                onClick={() => void emitir()}
                disabled={ocupado || marcadas.size === 0 || !vencimento}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2"
              >
                {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
                Emitir fatura
              </button>
            </div>
          </>
        )}

        {clienteId && cargas.length === 0 && aCotar.length === 0 && (
          <p className="text-sm text-gray-500">Este cliente não tem carga pronta para faturar.</p>
        )}

        {clienteId && aCotar.length > 0 && (
          <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            <p className="text-sm text-amber-700">
              {aCotar.length} carga(s) entregue(s) sem frete definido. Informe o valor para poder faturar.
            </p>
            <ul className="space-y-2">
              {aCotar.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex-1 min-w-[12rem] text-gray-700 dark:text-gray-300">
                    {formatDate(c.createdAt)} · {c.origin} → {c.destination} · {formatWeight(c.weight)}
                  </span>
                  <input
                    aria-label={`Frete da carga para ${c.destination}`}
                    inputMode="decimal"
                    placeholder="R$"
                    value={fretes[c.id] ?? ""}
                    onChange={(e) => setFretes({ ...fretes, [c.id]: e.target.value })}
                    className={`${INPUT} w-28`}
                  />
                  <button
                    onClick={() => void informarFrete(c.id)}
                    disabled={ocupado || !(fretes[c.id] ?? "").trim()}
                    className="text-blue-600 hover:underline disabled:opacity-50"
                  >
                    Gravar frete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <h2 className="font-semibold text-gray-900 dark:text-white px-6 pt-6 pb-3">Faturas emitidas</h2>
        {faturas.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p>Nenhuma fatura emitida até agora.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-6 py-4 font-medium">Nº</th>
                  <th className="px-6 py-4 font-medium">Cliente</th>
                  <th className="px-6 py-4 font-medium">Emissão</th>
                  <th className="px-6 py-4 font-medium">Vencimento</th>
                  <th className="px-6 py-4 font-medium">Cargas</th>
                  <th className="px-6 py-4 font-medium text-right">Total</th>
                  <th className="px-6 py-4 font-medium">Situação</th>
                  <th className="px-6 py-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {faturas.map((f) => (
                  <tr key={f.id}>
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                      <Link href={`/dashboard/faturamento/${f.id}`} className="text-blue-600 hover:underline">
                        {f.number}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{f.client.tradeName || f.client.companyName}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{formatDate(f.issuedAt)}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{formatCalendarDate(f.dueDate)}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{f._count.collections}</td>
                    <td className="px-6 py-4 text-right text-gray-900 dark:text-white">{formatCurrency(f.total)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS[f.status].classe}`}>{STATUS[f.status].rotulo}</span>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap space-x-4">
                      {f.status === "OPEN" && (
                        <>
                          <button disabled={ocupado} onClick={() => void agir(f, "pagar")} className="text-blue-600 hover:underline">
                            Marcar paga
                          </button>
                          <button disabled={ocupado} onClick={() => void agir(f, "cancelar")} className="text-red-600 hover:underline">
                            Cancelar
                          </button>
                        </>
                      )}
                      {f.status === "PAID" && (
                        <button disabled={ocupado} onClick={() => void agir(f, "reabrir")} className="text-blue-600 hover:underline">
                          Reabrir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
