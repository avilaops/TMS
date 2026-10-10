"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ImagePlus, Loader2, LogIn, ShieldAlert, Trash2, Truck } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IDENTIDADE_ALTERADA, LADO_DO_SIMBOLO, TAMANHO_MAXIMO_DO_SIMBOLO, type Identidade, type PixDaEmpresa } from "@/lib/empresa";
import type { ParametrosDeCobranca } from "@/lib/cobranca";
import { AVISO_PIX_ESTATICO, LIMITE_DA_CIDADE, LIMITE_DO_NOME, TIPOS_DE_CHAVE, TIPO_DE_CHAVE_LABEL, type TipoDeChave } from "@/lib/pix";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Identidade da empresa (o nome e o símbolo que aparecem no cabeçalho do
 * painel), os parâmetros de cobrança e a integração. Só o administrador altera.
 */

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null };

const FALHA = "Não foi possível carregar os dados da empresa.";
const FALHA_AO_SALVAR = "Não foi possível salvar.";
const IMAGEM_INVALIDA = "Não foi possível ler essa imagem. Use um arquivo PNG ou JPEG.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const INPUT =
  "block w-full min-w-0 px-3 py-2 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";

/**
 * Reduz a imagem escolhida para um quadrado pequeno, no próprio aparelho: foto
 * de celular tem vários megabytes, e o símbolo aparece com 40 pixels.
 */
async function reduzir(arquivo: File): Promise<string> {
  const imagem = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_DO_SIMBOLO / Math.max(imagem.width, imagem.height));
  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(imagem.width * escala));
  tela.height = Math.max(1, Math.round(imagem.height * escala));
  const contexto = tela.getContext("2d");
  if (!contexto) throw new Error("sem canvas");
  contexto.drawImage(imagem, 0, 0, tela.width, tela.height);
  // PNG mantém o fundo transparente do logotipo.
  return tela.toDataURL("image/png");
}

export default function EmpresaPage() {
  const [carga, setCarga] = useState<Carga | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // No celular aparece uma parte por vez; no computador, as três.
  const [aba, setAba] = useState<"identidade" | "cobranca" | "integracao">("identidade");

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa")
      .then(async (res) => {
        if (!ativo) return;
        const denied = deniedReason(res.status);
        if (denied) return setCarga({ denied });
        const corpo = (await res.json().catch(() => null)) as (Identidade & { error?: string }) | null;
        if (!res.ok || !corpo) return setCarga({ denied: null, erro: corpo?.error ?? FALHA });
        setName(corpo.name);
        setLogo(corpo.logo);
        setCarga({ denied: null, erro: null });
      })
      .catch(() => {
        if (ativo) setCarga({ denied: null, erro: FALHA });
      });
    return () => {
      ativo = false;
    };
  }, []);

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const escolhido = e.target.files?.[0];
    // Limpa o campo: escolher o mesmo arquivo de novo precisa disparar a troca.
    e.target.value = "";
    if (!escolhido) return;
    setMensagem(null);
    try {
      const reduzida = await reduzir(escolhido);
      if (reduzida.length > TAMANHO_MAXIMO_DO_SIMBOLO) {
        return setMensagem({ ok: false, texto: "Imagem muito grande. Use uma imagem menor." });
      }
      setLogo(reduzida);
    } catch {
      setMensagem({ ok: false, texto: IMAGEM_INVALIDA });
    }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/empresa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logo }),
      });
      const corpo = (await res.json().catch(() => null)) as (Identidade & { error?: string }) | null;
      if (!res.ok || !corpo) {
        setMensagem({ ok: false, texto: corpo?.error ?? FALHA_AO_SALVAR });
        return;
      }
      setName(corpo.name);
      setLogo(corpo.logo);
      setMensagem({ ok: true, texto: "Empresa atualizada." });
      window.dispatchEvent(new Event(IDENTIDADE_ALTERADA));
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setSalvando(false);
    }
  };

  if (!carga) {
    return (
      <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (carga.denied === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver os dados da empresa.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carga.denied !== null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>Seu perfil não tem acesso a esta área.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carga.erro !== null) {
    return (
      <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
        {carga.erro}
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Empresa</h1>
        <p className="hidden md:block text-gray-500 text-sm mt-1">Nome e símbolo que aparecem no topo do painel</p>
      </div>

      <div role="tablist" aria-label="Parte" className="md:hidden grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
        {(
          [
            ["identidade", "Identidade"],
            ["cobranca", "Cobrança"],
            ["integracao", "Integração"],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            data-aba={chave}
            onClick={() => setAba(chave)}
            className={`py-1.5 rounded-lg text-sm font-semibold ${aba === chave ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <form onSubmit={salvar} className={`${aba === "identidade" ? "" : "hidden md:block "}${CARD} p-3 md:p-6 space-y-4`}>
        <label className="block space-y-1">
          <span className={LABEL}>Nome da empresa</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </label>

        <div className="space-y-1">
          <span className={LABEL}>Símbolo</span>
          <div className="flex items-center gap-3">
            {logo ? (
              <Image src={logo} alt="Símbolo atual" width={56} height={56} unoptimized className="w-14 h-14 rounded-xl object-contain bg-white border border-gray-200 dark:border-gray-700" />
            ) : (
              <div data-simbolo-padrao className="w-14 h-14 rounded-xl bg-blue-600 flex items-center justify-center">
                <Truck className="w-7 h-7 text-white" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => arquivo.current?.click()}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 flex items-center gap-2"
              >
                <ImagePlus className="w-4 h-4" />
                Escolher imagem
              </button>
              {logo && (
                <button type="button" onClick={() => setLogo(null)} className="px-3 py-2 text-sm rounded-xl text-red-600 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  Remover
                </button>
              )}
            </div>
            <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp" onChange={escolher} className="hidden" aria-label="Arquivo do símbolo" />
          </div>
          <p className="text-xs text-gray-500">PNG, JPEG ou WebP. A imagem é reduzida antes de enviar. Sem símbolo, aparece o caminhão.</p>
        </div>

        {mensagem && (
          <p role={mensagem.ok ? "status" : "alert"} className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {mensagem.texto}
          </p>
        )}

        <button
          type="submit"
          disabled={salvando}
          className="px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2"
        >
          {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      </form>

      <Cobranca escondida={aba !== "cobranca"} />

      <Integracao escondida={aba !== "integracao"} />
    </div>
  );
}

/** O que a rota de cobrança devolve: os percentuais e, se cadastrado, o Pix. */
type CobrancaDaEmpresa = ParametrosDeCobranca & { pix?: PixDaEmpresa | null };

const SEM_PIX = { tipo: "CNPJ" as TipoDeChave, chave: "", nome: "", cidade: "" };

const EXEMPLO_DE_CHAVE: Record<TipoDeChave, string> = {
  CPF: "000.000.000-00",
  CNPJ: "00.000.000/0000-00",
  EMAIL: "financeiro@suaempresa.com.br",
  TELEFONE: "(17) 99999-0000",
  ALEATORIA: "123e4567-e89b-12d3-a456-426614174000",
};

/**
 * Parâmetros de cobrança: a multa e os juros que a baixa de um título vencido
 * sugere (Financeiro e Faturamento) e o recebimento por Pix. Os encargos são
 * só a sugestão: na baixa o operador altera ou apaga os valores. Com a chave
 * Pix cadastrada, a fatura e o aviso de cobrança saem com o Pix Copia e Cola.
 */
function Cobranca({ escondida }: { escondida: boolean }) {
  const [multaPct, setMultaPct] = useState("");
  const [jurosPct, setJurosPct] = useState("");
  const [pix, setPix] = useState(SEM_PIX);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  const mostrar = (corpo: CobrancaDaEmpresa) => {
    setMultaPct(String(corpo.multaPct).replace(".", ","));
    setJurosPct(String(corpo.jurosPct).replace(".", ","));
    setPix(corpo.pix ?? SEM_PIX);
  };

  const campoDoPix = (nome: keyof typeof SEM_PIX) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPix((atual) => ({ ...atual, [nome]: e.target.value }));

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa/cobranca")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: CobrancaDaEmpresa | null) => {
        if (ativo && corpo) mostrar(corpo);
      })
      .catch(() => {
        // Sem a leitura os campos ficam em branco e salvar pede os dois.
      });
    return () => {
      ativo = false;
    };
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/empresa/cobranca", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Chave em branco remove o Pix; preenchida, vai com o recebedor.
        body: JSON.stringify({ multaPct, jurosPct, pix: pix.chave.trim() === "" ? null : pix }),
      });
      const corpo = (await res.json().catch(() => null)) as (CobrancaDaEmpresa & { error?: string }) | null;
      if (!res.ok || !corpo) return setMensagem({ ok: false, texto: corpo?.error ?? FALHA_AO_SALVAR });
      mostrar(corpo);
      setMensagem({ ok: true, texto: "Cobrança atualizada." });
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={salvar} aria-label="Cobrança" className={`${escondida ? "hidden md:block " : ""}${CARD} p-3 md:p-6 space-y-3`}>
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Cobrança</h2>
        <p className="text-xs md:text-sm text-gray-500 mt-0.5">
          Multa e juros sugeridos na baixa de um título vencido. Os juros são proporcionais aos dias de atraso.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Multa (%)</span>
          <input required inputMode="decimal" data-campo="multaPct" value={multaPct} onChange={(e) => setMultaPct(e.target.value)} className={INPUT} />
        </label>
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Juros ao mês (%)</span>
          <input required inputMode="decimal" data-campo="jurosPct" value={jurosPct} onChange={(e) => setJurosPct(e.target.value)} className={INPUT} />
        </label>
      </div>

      <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
        <h3 className="pt-2 text-sm font-semibold text-gray-900 dark:text-white">Recebimento por Pix</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Com a chave cadastrada, a fatura e o aviso de cobrança saem com o Pix Copia e Cola. Chave em branco desliga.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Tipo da chave</span>
          <select data-campo="pixTipo" value={pix.tipo} onChange={campoDoPix("tipo")} className={INPUT}>
            {TIPOS_DE_CHAVE.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_DE_CHAVE_LABEL[tipo]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Chave Pix</span>
          <input data-campo="pixChave" maxLength={120} placeholder={EXEMPLO_DE_CHAVE[pix.tipo]} value={pix.chave} onChange={campoDoPix("chave")} className={INPUT} />
        </label>
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Nome do recebedor</span>
          <input data-campo="pixNome" maxLength={LIMITE_DO_NOME} required={pix.chave.trim() !== ""} value={pix.nome} onChange={campoDoPix("nome")} className={INPUT} />
        </label>
        <label className="block space-y-1 min-w-0">
          <span className={LABEL}>Cidade</span>
          <input data-campo="pixCidade" maxLength={LIMITE_DA_CIDADE} required={pix.chave.trim() !== ""} value={pix.cidade} onChange={campoDoPix("cidade")} className={INPUT} />
        </label>
      </div>
      <p className="text-xs text-gray-500">{AVISO_PIX_ESTATICO}</p>

      {mensagem && (
        <p role={mensagem.ok ? "status" : "alert"} className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      <button type="submit" disabled={ocupado} className="px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2">
        {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
        Salvar
      </button>
    </form>
  );
}

type Entrega = { id: string; type: string; createdAt: string; deliveredAt: string | null; attempts: number; lastError: string | null };
type Webhook = { url: string | null; entregas: Entrega[] };

const TIPO: Record<string, string> = {
  "coleta.status": "Status de carga",
  "fatura.emitida": "Fatura emitida",
  "fatura.paga": "Fatura paga",
  "fatura.reaberta": "Fatura reaberta",
  "fatura.cancelada": "Fatura cancelada",
  "cobranca.vencida": "Título vencido",
  "ocorrencia.aberta": "Chamado aberto",
  "ocorrencia.status": "Status de chamado",
  teste: "Teste",
};

const quando = (instante: string) =>
  new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function situacao(entrega: Entrega): { texto: string; classe: string } {
  if (entrega.deliveredAt) return { texto: "Entregue", classe: "text-green-700 dark:text-green-400" };
  if (entrega.attempts === 0) return { texto: "Na fila", classe: "text-gray-500" };
  return { texto: entrega.lastError ?? "Falhou", classe: "text-red-600 dark:text-red-400" };
}

/**
 * Endereço que recebe os eventos da empresa (um fluxo do n8n, por exemplo). A
 * cada troca de status de carga o TMS manda um aviso assinado para lá.
 */
function Integracao({ escondida }: { escondida: boolean }) {
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [url, setUrl] = useState("");
  const [segredo, setSegredo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  const ler = () =>
    fetch("/api/empresa/webhook")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: Webhook | null) => {
        if (!corpo) return;
        setWebhook(corpo);
        setUrl(corpo.url ?? "");
      })
      .catch(() => {
        // Sem a leitura a seção fica só com o campo vazio.
      });

  useEffect(() => {
    void ler();
  }, []);

  const gravar = async (corpo: { url: string | null; novoSegredo?: boolean }, sucesso: string) => {
    setOcupado(true);
    setMensagem(null);
    setSegredo(null);
    try {
      const res = await fetch("/api/empresa/webhook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const resposta = (await res.json().catch(() => null)) as { url?: string | null; segredo?: string; error?: string } | null;
      if (!res.ok || !resposta) return setMensagem({ ok: false, texto: resposta?.error ?? FALHA_AO_SALVAR });
      if (resposta.segredo) setSegredo(resposta.segredo);
      setMensagem({ ok: true, texto: sucesso });
      await ler();
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setOcupado(false);
    }
  };

  const testar = async () => {
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/empresa/webhook/teste", { method: "POST" });
      const resposta = (await res.json().catch(() => null)) as { error?: string } | null;
      setMensagem(res.ok ? { ok: true, texto: "Teste na fila. Ele sai em até 15 segundos; atualize para ver o resultado." } : { ok: false, texto: resposta?.error ?? "Não foi possível enviar o teste." });
      await ler();
    } catch {
      setMensagem({ ok: false, texto: "Não foi possível enviar o teste." });
    } finally {
      setOcupado(false);
    }
  };

  const cadastrado = Boolean(webhook?.url);

  return (
    <section aria-label="Integração" className={`${escondida ? "hidden md:block " : ""}${CARD} p-3 md:p-6 space-y-3`}>
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Integração</h2>
        <p className="text-xs md:text-sm text-gray-500 mt-0.5">
          O TMS avisa este endereço (um fluxo do n8n, por exemplo) a cada troca de status de carga, fatura emitida, paga ou cancelada, e título que venceu.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void gravar({ url: url.trim() }, cadastrado ? "Endereço atualizado." : "Endereço cadastrado.");
        }}
        className="space-y-2"
      >
        <label className="block space-y-1">
          <span className={LABEL}>Endereço que recebe os avisos</span>
          <input type="url" required placeholder="https://n8n.suaempresa.com/webhook/tms" value={url} onChange={(e) => setUrl(e.target.value)} className={INPUT} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={ocupado} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
            {cadastrado ? "Salvar endereço" : "Cadastrar"}
          </button>
          {cadastrado && (
            <>
              <button type="button" disabled={ocupado} onClick={() => void testar()} className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-60">
                Enviar teste
              </button>
              <button type="button" disabled={ocupado} onClick={() => void gravar({ url: url.trim(), novoSegredo: true }, "Segredo trocado.")} className="px-3 py-2 text-sm rounded-xl text-gray-600 dark:text-gray-300 disabled:opacity-60">
                Trocar segredo
              </button>
              <button type="button" disabled={ocupado} onClick={() => void gravar({ url: null }, "Integração removida.")} className="px-3 py-2 text-sm rounded-xl text-red-600 disabled:opacity-60">
                Remover
              </button>
            </>
          )}
        </div>
      </form>

      {segredo && (
        <div data-segredo className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 space-y-1">
          <p className="font-medium">Guarde este segredo agora: ele não aparece de novo.</p>
          <code className="block break-all font-mono text-xs">{segredo}</code>
          <p className="text-xs">É com ele que o destino confere a assinatura do cabeçalho X-TMS-Assinatura.</p>
        </div>
      )}

      {mensagem && (
        <p role={mensagem.ok ? "status" : "alert"} className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      {webhook && webhook.entregas.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <h3 className={LABEL}>Últimos avisos</h3>
            <button type="button" onClick={() => void ler()} className="text-xs text-blue-600 hover:underline">
              Atualizar
            </button>
          </div>
          <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            {webhook.entregas.map((entrega) => {
              const estado = situacao(entrega);
              return (
                <li key={entrega.id} data-entrega={entrega.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-gray-700 dark:text-gray-300">
                    {TIPO[entrega.type] ?? entrega.type} <span className="text-xs text-gray-500">· {quando(entrega.createdAt)}</span>
                  </span>
                  <span className={`text-xs text-right ${estado.classe}`}>{estado.texto}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
