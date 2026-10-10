"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Package, Plus, X, Loader2 } from "lucide-react";
import {
  COLLECTION_STATUS,
  formatCurrency,
  formatDate,
  formatWeight,
  statusBadge,
} from "@/lib/format";
import { PRIORIDADES, PRIORIDADE_LABEL, janelaDaColeta } from "@/lib/coletas";
import type { Destinatario } from "@/lib/portal-cliente";
import { readPortal, type PortalCollection } from "../types";
import { BOTAO, BOTAO_SECUNDARIO, CAMPO, Campo, NaoCarregou, ROTULO } from "../comum";

const EMPTY_FORM = {
  sender: "",
  receiver: "",
  origin: "",
  destination: "",
  volumes: "",
  weight: "",
  invoiceValue: "",
  cubicMeters: "",
  pickupDate: "",
  pickupFrom: "",
  pickupTo: "",
  priority: "NORMAL",
  pickupNotes: "",
};

// O que a Cotação manda no endereço ao "Pedir coleta com estes dados".
const DA_COTACAO = ["destination", "weight", "volumes", "invoiceValue", "cubicMeters"] as const;

const ROTULO_DA_CELULA =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none";

export default function PortalColetasPage() {
  // `useSearchParams` pede um limite de Suspense na geração da página.
  return (
    <Suspense fallback={<p className="p-6 text-gray-500">Carregando…</p>}>
      <Coletas />
    </Suspense>
  );
}

function Coletas() {
  const router = useRouter();
  const parametros = useSearchParams();
  // Vindo da Cotação, o pedido já abre preenchido com os dados cotados.
  const [daCotacao] = useState(() => {
    // A cotação aceita vírgula decimal; os campos numéricos daqui (e a rota do pedido) esperam ponto.
    const dados = Object.fromEntries(
      DA_COTACAO.map((campo) => [campo, campo === "destination" ? (parametros.get(campo) ?? "") : (parametros.get(campo) ?? "").trim().replace(",", ".")]),
    );
    return Object.values(dados).some((valor) => valor !== "") ? { ...EMPTY_FORM, ...dados } : null;
  });

  const [coletas, setColetas] = useState<PortalCollection[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(daCotacao !== null);
  const [form, setForm] = useState(daCotacao ?? EMPTY_FORM);
  // Janela, prioridade e observação são opcionais e ficam recolhidas: o pedido cabe na tela do celular.
  const [pedidoAberto, setPedidoAberto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  // Exportação: o período e o que deu errado ao baixar.
  const [exportando, setExportando] = useState(false);
  const [periodo, setPeriodo] = useState({ de: "", ate: "" });
  const [baixando, setBaixando] = useState(false);
  const [erroAoBaixar, setErroAoBaixar] = useState("");

  const carregar = () =>
    fetch("/api/portal/coletas")
      .then((r) => readPortal<PortalCollection[]>(r))
      .then(setColetas)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void carregar();
    // Sem a lista de destinatários o pedido segue funcionando: os campos são digitados.
    fetch("/api/portal/destinatarios")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Destinatario[]) => setDestinatarios(lista))
      .catch(() => undefined);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const response = await fetch("/api/portal/coletas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Não foi possível enviar a solicitação.");
      }

      setForm(EMPTY_FORM);
      setFormOpen(false);
      setPedidoAberto(false);
      setSuccess("Solicitação enviada. A transportadora confirma a coleta pelo WhatsApp.");
      // Tira do endereço os dados da cotação: recarregar não reabre o pedido já enviado.
      if (daCotacao) router.replace("/portal/coletas");
      await carregar();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field: keyof typeof EMPTY_FORM) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const escolherDestinatario = (id: string) => {
    const escolhido = destinatarios.find((d) => d.id === id);
    if (escolhido) setForm((current) => ({ ...current, receiver: escolhido.name, destination: escolhido.city }));
  };

  // O arquivo vem pelo `fetch` para o erro (período inválido, sessão expirada) aparecer na tela.
  const baixar = async (event: React.FormEvent) => {
    event.preventDefault();
    setBaixando(true);
    setErroAoBaixar("");
    try {
      const consulta = new URLSearchParams(Object.entries(periodo).filter(([, dia]) => dia !== ""));
      const response = await fetch(`/api/portal/coletas/exportar?${consulta.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Não foi possível gerar o arquivo.");
      }
      const nome = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "coletas.csv";
      const endereco = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = endereco;
      link.download = nome;
      link.click();
      URL.revokeObjectURL(endereco);
    } catch (e) {
      setErroAoBaixar((e as Error).message);
    } finally {
      setBaixando(false);
    }
  };

  if (error) return <NaoCarregou mensagem={error} />;

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Com o pedido aberto, o título e a lista saem da tela do celular. */}
      <div className={`${formOpen ? "hidden md:flex" : "flex"} flex-wrap gap-2 md:gap-4 items-center justify-between`}>
        <div>
          <h1 className="text-2xl font-outfit font-bold text-gray-900">Minhas coletas</h1>
          <p className="hidden md:block text-gray-500">Solicite uma coleta e acompanhe o andamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={exportando}
            onClick={() => {
              setExportando((aberto) => !aberto);
              setErroAoBaixar("");
            }}
            className={BOTAO_SECUNDARIO}
          >
            <Download className="w-4 h-4" />
            Baixar
          </button>
          <button
            onClick={() => {
              setFormOpen(true);
              setSuccess("");
            }}
            className={BOTAO}
          >
            <Plus className="w-4 h-4" />
            Solicitar coleta
          </button>
        </div>
      </div>

      {success && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-3 md:p-4 text-sm">
          {success}
        </div>
      )}

      {exportando && !formOpen && (
        <form onSubmit={baixar} aria-label="Baixar coletas" className="bg-white border border-gray-200 rounded-2xl p-3 md:p-4 space-y-2">
          <div className="grid grid-cols-2 md:flex md:flex-wrap md:items-end gap-x-3 gap-y-2">
            <Campo rotulo="De" type="date" value={periodo.de} onChange={(e) => setPeriodo((atual) => ({ ...atual, de: e.target.value }))} />
            <Campo rotulo="Até" type="date" value={periodo.ate} onChange={(e) => setPeriodo((atual) => ({ ...atual, ate: e.target.value }))} />
            <button type="submit" disabled={baixando} className={`${BOTAO} col-span-2`}>
              {baixando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Baixar planilha (CSV)
            </button>
          </div>
          <p className="text-xs text-gray-500">Cargas solicitadas no período, para abrir no Excel. Sem datas, vêm os últimos 30 dias.</p>
          {erroAoBaixar && (
            <p role="alert" className="text-sm text-red-600">
              {erroAoBaixar}
            </p>
          )}
        </form>
      )}

      {formOpen && (
        <form onSubmit={handleSubmit} aria-label="Pedido de coleta" className="bg-white border border-gray-200 rounded-2xl p-3 md:p-6 space-y-2 md:space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-outfit font-bold text-lg">Nova solicitação de coleta</h2>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => {
                setFormOpen(false);
                setFormError("");
              }}
              className="p-1.5 text-gray-500 hover:text-gray-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {formError && (
            <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
              {formError}
            </p>
          )}

          {destinatarios.length > 0 && (
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={ROTULO}>Destinatário frequente</span>
              <select aria-label="Destinatário frequente" defaultValue="" onChange={(e) => escolherDestinatario(e.target.value)} className={CAMPO}>
                <option value="">Escolher da minha lista…</option>
                {destinatarios.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.city})
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <Campo rotulo="Remetente" value={form.sender} onChange={setField("sender")} required />
            <Campo rotulo="Destinatário" value={form.receiver} onChange={setField("receiver")} required />
            <Campo rotulo="Cidade de origem" value={form.origin} onChange={setField("origin")} required />
            <Campo rotulo="Cidade de destino" value={form.destination} onChange={setField("destination")} required />
            <Campo rotulo="Volumes" type="number" min="1" value={form.volumes} onChange={setField("volumes")} required />
            <Campo rotulo="Peso (kg)" type="number" min="0.1" step="0.1" value={form.weight} onChange={setField("weight")} required />
            <Campo rotulo="Valor da nota (opcional)" type="number" min="0" step="0.01" value={form.invoiceValue} onChange={setField("invoiceValue")} />
            <Campo rotulo="Cubagem (m³, opcional)" type="number" min="0" step="0.001" value={form.cubicMeters} onChange={setField("cubicMeters")} />
          </div>

          <div className="rounded-xl border border-gray-100">
            <button
              type="button"
              aria-expanded={pedidoAberto}
              data-secao="pedido"
              onClick={() => setPedidoAberto((aberto) => !aberto)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700"
            >
              <span>Horário, prioridade e observação (opcional)</span>
              <span aria-hidden className="text-gray-400">{pedidoAberto ? "−" : "+"}</span>
            </button>
            {pedidoAberto && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 px-3 pb-3">
                <Campo rotulo="Data da coleta" type="date" value={form.pickupDate} onChange={setField("pickupDate")} />
                <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
                  <span className={ROTULO}>Prioridade</span>
                  <select value={form.priority} onChange={setField("priority")} className={CAMPO}>
                    {PRIORIDADES.map((prioridade) => (
                      <option key={prioridade} value={prioridade}>
                        {PRIORIDADE_LABEL[prioridade]}
                      </option>
                    ))}
                  </select>
                </label>
                <Campo rotulo="Coletar das" type="time" value={form.pickupFrom} onChange={setField("pickupFrom")} />
                <Campo rotulo="até" type="time" value={form.pickupTo} onChange={setField("pickupTo")} />
                <Campo rotulo="Observação para a coleta" className="col-span-2" maxLength={500} value={form.pickupNotes} onChange={setField("pickupNotes")} placeholder="Ex.: procurar o João na doca 2" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="submit" disabled={saving} className={BOTAO}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar solicitação
            </button>
            <p className="text-xs md:text-sm text-gray-500">A confirmação da coleta é sempre humana, pelo WhatsApp.</p>
          </div>
        </form>
      )}

      <div className={`${formOpen ? "hidden md:block " : ""}bg-white rounded-2xl border border-gray-200 overflow-hidden`}>
        {loading ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : coletas.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Nenhuma coleta registrada até agora.</p>
          </div>
        ) : (
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Trajeto</th>
                <th className="px-6 py-3 font-medium">Data</th>
                <th className="px-6 py-3 font-medium">Rastreio</th>
                <th className="px-6 py-3 font-medium">Destinatário</th>
                <th className="px-6 py-3 font-medium">Volumes / Peso</th>
                <th className="px-6 py-3 font-medium">Frete</th>
                <th className="px-6 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100">
              {coletas.map((coleta) => {
                const badge = statusBadge(COLLECTION_STATUS, coleta.status);
                const janela = janelaDaColeta(coleta);
                return (
                  <tr key={coleta.id} data-coleta={coleta.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row hover:bg-gray-50/60">
                    <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4 font-medium text-gray-900">
                      <Link href={`/portal/coletas/${coleta.id}`} className="hover:text-orange-600 hover:underline">
                        {coleta.origin} → {coleta.destination}
                      </Link>
                      {(coleta.priority === "URGENT" || janela) && (
                        <span className="block text-xs font-normal text-gray-500">
                          {coleta.priority === "URGENT" && <span className="font-semibold text-red-700">Urgente </span>}
                          {janela && `Coletar ${janela}`}
                        </span>
                      )}
                    </td>
                    <td data-rotulo="Data" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO_DA_CELULA}`}>{formatDate(coleta.createdAt)}</td>
                    <td data-rotulo="Rastreio" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 font-mono ${ROTULO_DA_CELULA}`}>{coleta.trackingCode ?? "-"}</td>
                    <td data-rotulo="Destinatário" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 break-words ${ROTULO_DA_CELULA}`}>{coleta.receiver}</td>
                    <td data-rotulo="Volumes / Peso" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO_DA_CELULA}`}>
                      {coleta.volumes} · {formatWeight(coleta.weight)}
                    </td>
                    <td data-rotulo="Frete" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO_DA_CELULA}`}>
                      {coleta.freightValue == null ? "A cotar" : formatCurrency(coleta.freightValue)}
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 self-end">
                      <span className={`inline-block text-xs px-3 py-1 rounded-full border whitespace-nowrap ${badge.className}`}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
