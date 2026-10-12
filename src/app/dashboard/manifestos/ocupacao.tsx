import { AlertTriangle, Scale } from "lucide-react";
import { type CargaDaOcupacao, type VeiculoDaOcupacao, linhaDaOcupacao, ocupacaoDaViagem } from "@/lib/ocupacao";

/**
 * A linha da ocupação do veículo: "Peso 1.250 de 3.000 kg (42%) · Cubagem 8,2
 * de 20 m³ (41%)". Uma linha só, cortada com reticências se não couber: no
 * cartão da viagem ela não pode aumentar a altura mais que isso. Acima de 100%
 * a linha fica em âmbar, com o sinal de aviso; sem capacidade cadastrada, uma
 * frase discreta. As contas estão em src/lib/ocupacao.ts.
 */
export function LinhaDeOcupacao({ cargas, veiculo, className = "" }: { cargas: readonly CargaDaOcupacao[]; veiculo: VeiculoDaOcupacao | null | undefined; className?: string }) {
  const ocupacao = ocupacaoDaViagem(cargas, veiculo);
  const texto = linhaDaOcupacao(ocupacao);
  const Icone = ocupacao.excesso ? AlertTriangle : Scale;
  const cor = ocupacao.excesso ? "text-amber-700 dark:text-amber-400 font-semibold" : ocupacao.semCapacidade ? "text-gray-400" : "text-gray-600 dark:text-gray-300";
  return (
    <p
      data-ocupacao={ocupacao.excesso ? "excesso" : ocupacao.semCapacidade ? "sem-capacidade" : "cabe"}
      title={texto}
      // No celular a letra é a menor que ainda se lê e a linha não leva o ícone, para as duas medidas caberem na
      // largura do cartão numa linha só. No computador o cartão é estreito (três por linha) e a frase pode quebrar.
      className={`flex items-start gap-1 min-w-0 text-[11px] leading-4 md:text-xs ${cor} ${className}`}
    >
      <Icone className="hidden md:block w-3.5 h-3.5 shrink-0 mt-px" />
      <span data-texto-da-ocupacao className="min-w-0 truncate md:whitespace-normal md:overflow-visible">
        {texto}
      </span>
    </p>
  );
}
