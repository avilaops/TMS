"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";

/** O documento auxiliar que o botão baixa: o DANFE de uma NF-e, o DACTE de um CT-e autorizado ou o DAMDFE de um MDF-e autorizado. */
const DOCUMENTOS = {
  danfe: { rotulo: "DANFE (PDF)", falha: "Não foi possível gerar o DANFE.", arquivo: "danfe.pdf" },
  dacte: { rotulo: "DACTE (PDF)", falha: "Não foi possível gerar o DACTE.", arquivo: "dacte.pdf" },
  damdfe: { rotulo: "DAMDFE (PDF)", falha: "Não foi possível gerar o DAMDFE.", arquivo: "damdfe.pdf" },
} as const;

/**
 * Botão "DANFE (PDF)" de uma nota fiscal, ao lado de "Baixar XML". Usado no
 * painel (documentos fiscais) e no portal do cliente; `endereco` é a rota que
 * devolve o PDF. Com `documento="dacte"` é o botão "DACTE (PDF)" de um CT-e
 * autorizado, na tela de CT-e; com `documento="damdfe"`, o "DAMDFE (PDF)" de um
 * MDF-e autorizado.
 *
 * O arquivo vem pelo `fetch`, e não por um link direto, porque o PDF é gerado
 * na hora por um serviço de fora: se ele demorar ou recusar a nota, o motivo
 * aparece aqui em vez de o navegador baixar uma página de erro.
 *
 * Quem decide se o botão aparece é quem o usa: com o recurso desligado
 * (`FISCAL_MCP_URL` ausente), as rotas avisam e a tela não o desenha.
 */
export function BotaoDanfe({ endereco, className = "", documento = "danfe" }: { endereco: string; className?: string; documento?: keyof typeof DOCUMENTOS }) {
  const { rotulo, falha, arquivo: nomePadrao } = DOCUMENTOS[documento];
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  const baixar = async () => {
    setGerando(true);
    setErro("");
    try {
      const res = await fetch(endereco);
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(res.status === 401 ? "Sessão expirada. Entre de novo." : (corpo?.error ?? falha));
      }
      const nome = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? nomePadrao;
      const arquivo = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = arquivo;
      link.download = nome;
      link.click();
      URL.revokeObjectURL(arquivo);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : falha);
    } finally {
      setGerando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        {...{ [`data-${documento}`]: true }}
        onClick={() => void baixar()}
        disabled={gerando}
        className={`inline-flex items-center gap-1 hover:underline disabled:opacity-60 ${className}`}
      >
        {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {rotulo}
      </button>
      {erro && (
        <span role="alert" className="basis-full text-xs text-red-600">
          {erro}
        </span>
      )}
    </>
  );
}
