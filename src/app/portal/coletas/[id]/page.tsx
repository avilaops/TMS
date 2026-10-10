"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Circle, Loader2, Printer, Truck, XCircle } from "lucide-react";
import { formatCurrency, formatWeight } from "@/lib/format";
import { janelaDaColeta } from "@/lib/coletas";
import { BotaoDanfe } from "@/components/fiscal/botao-danfe";
import { ROTULO_DA_FOTO, rotuloDaRelacao, rotuloDaRessalva, type TipoDeFoto } from "@/lib/comprovantes";

type Detalhe = {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceValue: number | null;
  freightValue: number | null;
  freightDeadlineHours: number | null;
  pickupDate: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  priority: string;
  cubicMeters: number | null;
  pickupNotes: string | null;
  status: string;
  createdAt: string;
  trackingCode: string | null;
  client: { cnpj: string };
  statusHistory: { toStatus: string; createdAt: string }[];
  manifest: { driver: { user: { name: string } } } | null;
  fiscalDocuments: { id: string; number: number; series: number; accessKey: string }[];
  /** O serviço que gera o DANFE está ligado? */
  danfe?: boolean;
  proof: {
    receiverName: string;
    receiverDoc: string;
    photoBase64: string | null;
    signatureBase64: string | null;
    createdAt: string;
    // Quem recebeu em relação ao destinatário; nulo no comprovante antigo.
    receiverRelation?: string | null;
    // Fotos por tipo: só as da entrega e do canhoto chegam ao portal.
    photos?: { id: string; kind: string; dataUrl: string; createdAt: string }[];
  } | null;
  /** Ressalva da entrega (tipo e descrição). Aparece assim que a entrega é registrada. */
  exception?: { type: string; note: string | null } | null;
};

const ROTULO: Record<string, string> = {
  PENDING: "Coleta solicitada",
  CONFIRMED: "Coleta confirmada",
  COLLECTED: "Carga coletada",
  ROUTE: "Saiu para entrega",
  DELIVERED: "Entregue",
  REJECTED: "Coleta recusada",
  CANCELLED: "Cancelada",
};

const ETAPAS = ["PENDING", "CONFIRMED", "COLLECTED", "ROUTE", "DELIVERED"];
const ENCERRADA_SEM_ENTREGA = ["REJECTED", "CANCELLED"];

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** A baixa grava a imagem como data URL ou só o base64; a tela aceita os dois. */
const imagem = (valor: string) => (valor.startsWith("data:") ? valor : `data:image/jpeg;base64,${valor}`);

export default function PortalColetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [coleta, setColeta] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/coletas/${id}`)
      .then(async (res) => {
        if (res.status === 401) return window.location.assign("/login");
        if (res.status === 404) return setErro("Coleta não encontrada.");
        if (!res.ok) throw new Error();
        setColeta((await res.json()) as Detalhe);
      })
      .catch(() => setErro("Não foi possível carregar a coleta. Atualize a página."));
  }, [id]);

  if (erro) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 p-8 flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
        <div>
          <h1 className="font-outfit font-bold text-lg mb-1">{erro}</h1>
          <Link href="/portal/coletas" className="text-sm text-orange-600 hover:underline">
            Voltar para as minhas coletas
          </Link>
        </div>
      </div>
    );
  }

  if (!coleta) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const semEntrega = ENCERRADA_SEM_ENTREGA.includes(coleta.status);
  const etapaAtual = ETAPAS.indexOf(coleta.status);
  const quando = (status: string) => {
    const passo = coleta.statusHistory.filter((p) => p.toStatus === status).at(-1);
    return passo ? dataHora.format(new Date(passo.createdAt)) : null;
  };

  const linkPublico = coleta.trackingCode
    ? `${window.location.origin}/rastreio?cnpj=${coleta.client.cnpj}&codigo=${coleta.trackingCode}`
    : null;

  const copiar = async () => {
    if (!linkPublico) return;
    try {
      await navigator.clipboard.writeText(linkPublico);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link href="/portal/coletas" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 print:hidden">
        <ArrowLeft className="w-4 h-4" />
        Minhas coletas
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xs text-gray-500">
          Solicitada em {dataHora.format(new Date(coleta.createdAt))}
          {coleta.trackingCode ? ` · código ${coleta.trackingCode}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-outfit font-bold text-gray-900">
          {coleta.origin} → {coleta.destination}
        </h1>
        <p className="mt-1 text-gray-600">{ROTULO[coleta.status] ?? coleta.status}</p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Dado rotulo="Remetente" valor={coleta.sender} />
          <Dado rotulo="Destinatário" valor={coleta.receiver} />
          <Dado rotulo="Volumes e peso" valor={`${coleta.volumes} · ${formatWeight(coleta.weight)}`} />
          <Dado rotulo="Valor da mercadoria" valor={formatCurrency(coleta.invoiceValue)} />
          <Dado
            rotulo="Frete"
            valor={
              coleta.freightValue == null
                ? "A cotar pela transportadora"
                : `${formatCurrency(coleta.freightValue)}${coleta.freightDeadlineHours ? ` · prazo de ${coleta.freightDeadlineHours} h` : ""}`
            }
          />
          {(janelaDaColeta(coleta) || coleta.priority === "URGENT") && (
            <Dado
              rotulo="Coleta pedida para"
              valor={[janelaDaColeta(coleta), coleta.priority === "URGENT" ? "urgente" : ""].filter(Boolean).join(" · ")}
            />
          )}
          {coleta.cubicMeters != null && <Dado rotulo="Cubagem" valor={`${coleta.cubicMeters.toLocaleString("pt-BR")} m³`} />}
          {coleta.pickupNotes && <Dado rotulo="Observação para a coleta" valor={coleta.pickupNotes} />}
        </dl>

        {coleta.fiscalDocuments.length > 0 && (
          <div className="mt-4 text-sm print:hidden" data-notas>
            <p className="text-xs text-gray-500">Notas fiscais desta carga</p>
            <ul className="mt-1 space-y-1">
              {coleta.fiscalDocuments.map((nota) => (
                <li key={nota.id} className="flex flex-wrap items-center gap-x-3">
                  <span className="font-medium text-gray-900">
                    NF-e {nota.number} / {nota.series}
                  </span>
                  <a href={`/api/portal/coletas/${coleta.id}/notas/${nota.id}`} download className="text-orange-600 hover:underline">
                    Baixar XML
                  </a>
                  {coleta.danfe && <BotaoDanfe endereco={`/api/portal/coletas/${coleta.id}/notas/${nota.id}/danfe`} className="text-orange-600" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {coleta.manifest && !semEntrega && coleta.status !== "DELIVERED" && (
          <p className="mt-4 text-sm text-gray-600 flex items-center gap-2">
            <Truck className="w-4 h-4 text-orange-500" />
            Motorista: {coleta.manifest.driver.user.name}
          </p>
        )}

        {linkPublico && (
          <div className="mt-5 pt-5 border-t border-gray-100 print:hidden">
            <p className="text-sm text-gray-600">
              Quem vai receber a carga pode acompanhar por este link, sem precisar de login:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                readOnly
                aria-label="Link público de rastreio"
                value={linkPublico}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-xs font-mono"
              />
              <button type="button" onClick={() => void copiar()} className="text-sm text-orange-600 hover:underline">
                {copiado ? "Copiado" : "Copiar link"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 print:hidden">
        <h2 className="font-outfit font-bold text-lg">Andamento</h2>
        {semEntrega ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-red-700">
            <XCircle className="w-5 h-5" />
            {ROTULO[coleta.status]}
            {quando(coleta.status) ? ` em ${quando(coleta.status)}` : ""}.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {ETAPAS.map((etapa, i) => {
              const feita = i <= etapaAtual;
              const hora = feita ? quando(etapa) : null;
              return (
                <li key={etapa} className="flex items-start gap-3">
                  {feita ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className={feita ? "text-sm font-medium text-gray-900" : "text-sm text-gray-400"}>
                      {ROTULO[etapa]}
                      {i === etapaAtual && <span className="sr-only"> (situação atual)</span>}
                    </p>
                    {hora && <p className="text-xs text-gray-500">{hora}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-outfit font-bold text-lg">Comprovante de entrega</h2>
          {coleta.proof && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 text-sm text-orange-600 hover:underline print:hidden"
            >
              <Printer className="w-4 h-4" />
              Imprimir ou salvar em PDF
            </button>
          )}
        </div>

        {coleta.exception && (
          <div data-ressalva className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Entrega com ressalva: {rotuloDaRessalva(coleta.exception.type) ?? coleta.exception.type}</p>
            {coleta.exception.note && <p className="whitespace-pre-wrap break-words">{coleta.exception.note}</p>}
          </div>
        )}

        {!coleta.proof ? (
          <p className="mt-3 text-sm text-gray-500">
            {coleta.status === "DELIVERED"
              ? "A entrega foi registrada e o comprovante está em conferência pela transportadora."
              : "O comprovante aparece aqui depois da entrega."}
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            <dl className="grid gap-4 sm:grid-cols-3 text-sm">
              <Dado
                rotulo="Recebido por"
                valor={`${coleta.proof.receiverName}${rotuloDaRelacao(coleta.proof.receiverRelation) ? ` (${rotuloDaRelacao(coleta.proof.receiverRelation)})` : ""}`}
              />
              <Dado rotulo="Documento" valor={coleta.proof.receiverDoc} />
              <Dado rotulo="Registrado em" valor={dataHora.format(new Date(coleta.proof.createdAt))} />
            </dl>
            <div className="grid gap-5 sm:grid-cols-2">
              {coleta.proof.photoBase64 && (
                <figure>
                  <figcaption className="text-xs text-gray-500 mb-2">Foto da entrega</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagem(coleta.proof.photoBase64)} alt="Foto da entrega" className="w-full rounded-xl border border-gray-200" />
                </figure>
              )}
              {(coleta.proof.photos ?? []).map((foto) => {
                const legenda = Object.hasOwn(ROTULO_DA_FOTO, foto.kind) ? ROTULO_DA_FOTO[foto.kind as TipoDeFoto] : "Foto";
                return (
                  <figure key={foto.id} data-foto={foto.kind}>
                    <figcaption className="text-xs text-gray-500 mb-2">{legenda}</figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagem(foto.dataUrl)} alt={legenda} className="w-full rounded-xl border border-gray-200" />
                  </figure>
                );
              })}
              {coleta.proof.signatureBase64 && (
                <figure>
                  <figcaption className="text-xs text-gray-500 mb-2">Assinatura de quem recebeu</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagem(coleta.proof.signatureBase64)}
                    alt="Assinatura de quem recebeu"
                    className="w-full rounded-xl border border-gray-200 bg-white"
                  />
                </figure>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-gray-900 break-words">{valor}</dd>
    </div>
  );
}
