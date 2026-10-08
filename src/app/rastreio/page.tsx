"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, PackageSearch, Truck, XCircle } from "lucide-react";

/**
 * Rastreio público: quem recebeu o código acompanha a carga sem ter login.
 *
 * A consulta exige o CNPJ/CPF do cliente junto do código (`/api/rastreio`), e
 * toda falha volta igual: a página não tem como dizer qual dos dois estava
 * errado, de propósito. O link pode vir preenchido (`?cnpj=…&codigo=…`), para
 * a transportadora mandar pronto ao destinatário.
 */

type Carga = {
  trackingCode: string;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
  statusHistory: { toStatus: string; createdAt: string }[];
  tenant: { name: string };
  manifest: { driver: { user: { name: string } } } | null;
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

// O caminho normal de uma carga. Recusa e cancelamento encerram fora dele.
const ETAPAS = ["PENDING", "CONFIRMED", "COLLECTED", "ROUTE", "DELIVERED"];
const ENCERRADA_SEM_ENTREGA = ["REJECTED", "CANCELLED"];

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const campo =
  "w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 outline-none focus:ring-2 focus:ring-blue-500";

export default function Rastreio() {
  const [cnpj, setCnpj] = useState("");
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [carga, setCarga] = useState<Carga | null>(null);

  const consultar = async (documento: string, rastreio: string) => {
    setBuscando(true);
    setErro("");
    setCarga(null);
    try {
      const res = await fetch(`/api/rastreio?cnpj=${encodeURIComponent(documento)}&codigo=${encodeURIComponent(rastreio)}`);
      if (res.status === 429) {
        setErro("Muitas consultas seguidas. Tente de novo em alguns minutos.");
      } else if (!res.ok) {
        setErro("Informe o CNPJ ou CPF e o código de rastreio.");
      } else {
        const lista = (await res.json()) as Carga[];
        if (lista.length === 0) setErro("Não encontramos carga com esses dados. Confira o documento e o código.");
        else setCarga(lista[0]);
      }
    } catch {
      setErro("Não foi possível consultar agora. Tente de novo.");
    } finally {
      setBuscando(false);
    }
  };

  // Link que já vem preenchido consulta sozinho, uma vez.
  const jaConsultou = useRef(false);
  useEffect(() => {
    if (jaConsultou.current) return;
    jaConsultou.current = true;
    const query = new URLSearchParams(window.location.search);
    const documento = query.get("cnpj") ?? "";
    const rastreio = query.get("codigo") ?? "";
    setCnpj(documento);
    setCodigo(rastreio);
    if (documento && rastreio) void consultar(documento, rastreio);
  }, []);

  const semEntrega = carga ? ENCERRADA_SEM_ENTREGA.includes(carga.status) : false;
  const etapaAtual = carga ? ETAPAS.indexOf(carga.status) : -1;
  const quando = (status: string) => {
    const passo = carga?.statusHistory.filter((p) => p.toStatus === status).at(-1);
    return passo ? dataHora.format(new Date(passo.createdAt)) : null;
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white">
            <PackageSearch className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rastrear carga</h1>
            <p className="text-sm text-gray-500">Acompanhe a sua coleta ou entrega.</p>
          </div>
        </div>

        <form
          className="mt-6 p-5 bg-white border border-gray-200 rounded-2xl space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void consultar(cnpj, codigo);
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="rastreio-documento" className="text-sm font-medium text-gray-700">
              CNPJ ou CPF de quem contratou o frete
            </label>
            <input
              id="rastreio-documento"
              required
              inputMode="numeric"
              autoComplete="off"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              className={campo}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rastreio-codigo" className="text-sm font-medium text-gray-700">
              Código de rastreio
            </label>
            <input
              id="rastreio-codigo"
              required
              inputMode="numeric"
              autoComplete="off"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={campo}
            />
          </div>
          <button
            type="submit"
            disabled={buscando}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {buscando && <Loader2 className="w-4 h-4 animate-spin" />}
            Rastrear
          </button>
        </form>

        {erro && (
          <div role="alert" className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            {erro}
          </div>
        )}

        {carga && (
          <section aria-live="polite" className="mt-4 p-5 bg-white border border-gray-200 rounded-2xl">
            <p className="text-xs text-gray-500">
              {carga.tenant.name} · código {carga.trackingCode}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{ROTULO[carga.status] ?? carga.status}</p>
            <p className="mt-1 text-sm text-gray-600">
              {carga.origin} → {carga.destination}
            </p>
            {carga.manifest && !semEntrega && carga.status !== "DELIVERED" && (
              <p className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-600" />
                Motorista: {carga.manifest.driver.user.name}
              </p>
            )}

            {semEntrega ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-red-700">
                <XCircle className="w-5 h-5" />
                {ROTULO[carga.status]}
                {quando(carga.status) ? ` em ${quando(carga.status)}` : ""}. Fale com a transportadora.
              </p>
            ) : (
              <ol className="mt-5 space-y-4">
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
          </section>
        )}
      </div>
    </main>
  );
}
