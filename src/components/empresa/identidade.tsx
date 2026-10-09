"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Truck } from "lucide-react";
import { IDENTIDADE_ALTERADA, type Identidade } from "@/lib/empresa";

/**
 * Nome e símbolo da empresa da sessão, para os cabeçalhos do painel, do portal
 * do cliente e do app do motorista. Enquanto não chegam (ou se a leitura
 * falhar), devolve `null` e cada cabeçalho mostra o seu texto padrão.
 */
export function useIdentidade(): Identidade | null {
  const [identidade, setIdentidade] = useState<Identidade | null>(null);

  useEffect(() => {
    let ativo = true;
    const ler = () =>
      fetch("/api/empresa")
        .then((res) => (res.ok ? res.json() : null))
        .then((corpo: Identidade | null) => {
          if (ativo && corpo) setIdentidade(corpo);
        })
        .catch(() => {
          // Sem a identidade o cabeçalho segue com o nome e o símbolo do sistema.
        });
    void ler();
    // A tela /dashboard/empresa avisa quando o administrador salva.
    window.addEventListener(IDENTIDADE_ALTERADA, ler);
    return () => {
      ativo = false;
      window.removeEventListener(IDENTIDADE_ALTERADA, ler);
    };
  }, []);

  return identidade;
}

const TAMANHOS = {
  pequeno: { lado: 32, caixa: "w-8 h-8 rounded-lg", icone: "w-4 h-4" },
  grande: { lado: 40, caixa: "w-10 h-10 rounded-xl", icone: "w-5 h-5" },
} as const;

/** Símbolo da empresa; sem símbolo cadastrado, o caminhão do sistema. */
export function SimboloDaEmpresa({ logo, tamanho = "pequeno" }: { logo: string | null; tamanho?: keyof typeof TAMANHOS }) {
  const { lado, caixa, icone } = TAMANHOS[tamanho];
  if (logo) {
    return <Image src={logo} alt="" width={lado} height={lado} unoptimized className={`${caixa} shrink-0 object-contain bg-white`} />;
  }
  return (
    <div data-simbolo-padrao className={`${caixa} shrink-0 bg-blue-600 flex items-center justify-center`}>
      <Truck className={`text-white ${icone}`} />
    </div>
  );
}
