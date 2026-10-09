"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ImagePlus, Loader2, LogIn, ShieldAlert, Trash2, Truck } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IDENTIDADE_ALTERADA, LADO_DO_SIMBOLO, TAMANHO_MAXIMO_DO_SIMBOLO, type Identidade } from "@/lib/empresa";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Identidade da empresa: o nome e o símbolo que aparecem no cabeçalho do
 * painel. Só o administrador altera.
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
          <CardDescription>Os dados da empresa são restritos ao perfil Administrador.</CardDescription>
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
        <p className="text-gray-500 text-sm mt-1">Nome e símbolo que aparecem no topo do painel</p>
      </div>

      <form onSubmit={salvar} className={`${CARD} p-3 md:p-6 space-y-4`}>
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
    </div>
  );
}
