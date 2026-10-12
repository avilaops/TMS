import type { ReactNode } from "react";
import { SimboloDaEmpresa } from "@/components/empresa/identidade";
import { formatCalendarDate, formatCurrency, formatDate, formatDocument } from "@/lib/format";
import { rotuloDoMotivo } from "@/lib/equipe";
import {
  AVISO_DO_DEMONSTRATIVO,
  EXPLICACAO_DO_PARCEIRO,
  EXPLICACAO_SEM_KM,
  PARCELAS,
  ROTULO_DA_PARCELA,
  TITULO_DO_DEMONSTRATIVO,
  type ReciboDoFechamento,
  basesPorExtenso,
  formasPorExtenso,
  mesPorExtenso,
  parcelasPorExtenso,
} from "@/lib/remuneracao";

/**
 * A folha do demonstrativo de remuneração variável de um fechamento: uma A4 em
 * retrato, em preto e branco, no molde do recibo de frete
 * (../../../../manifestos/[id]/recibo-frete/folha.tsx). Só desenha o que a rota
 * entregou (`GET /api/equipe/fechamento/[id]`): os valores congelados no
 * fechamento, não a conta de hoje.
 *
 * Não é holerite nem recibo de salário, e o rodapé diz isso.
 */

// No papel só a folha sai: o menu, o cabeçalho do painel e os botões ficam
// invisíveis, e a folha sobe para o canto da página. Vale só nesta página.
export const ESTILO_DE_IMPRESSAO = `
@media print {
  body * { visibility: hidden; }
  [data-recibo], [data-recibo] * { visibility: visible; }
  [data-recibo] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  [data-recibo] section { break-inside: avoid; page-break-inside: avoid; }
  /* As viagens podem não caber numa folha: quebram entre linhas. */
  [data-recibo] section[data-secao="viagens"] { break-inside: auto; page-break-inside: auto; orphans: 3; widows: 3; }
  [data-recibo] [data-viagem] { break-inside: avoid; page-break-inside: avoid; }
  [data-recibo] h2 { break-after: avoid; page-break-after: avoid; }
  /* As assinaturas e o rodapé não se separam. */
  [data-recibo] [data-fecho] { break-inside: avoid; page-break-inside: avoid; }
  /* O símbolo padrão é um desenho branco sobre fundo de cor: sem isto o navegador tira o fundo e ele some. */
  [data-recibo] header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { size: A4 portrait; margin: 10mm; }
`;

const ROTULO = "text-[10px] uppercase tracking-wide text-gray-600 leading-tight";
const SECAO = "border border-gray-400 rounded-md p-2";
const TITULO_DA_SECAO = "text-[11px] font-bold uppercase tracking-wide leading-tight mb-1";

/** Rótulo em cima, valor embaixo. */
function Campo({ rotulo, children, className = "" }: { rotulo: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className={ROTULO}>{rotulo}</p>
      <p className="text-sm leading-snug break-words min-h-5">{children}</p>
    </div>
  );
}

/** Uma linha da conta: o que é, à esquerda; quanto, à direita. */
function Linha({ rotulo, valor, forte = false, sinal = "" }: { rotulo: string; valor: number; forte?: boolean; sinal?: "" | "−" }) {
  return (
    <li data-conta={rotulo} className={`flex justify-between gap-3 border-t border-dotted border-gray-400 ${forte ? "font-bold text-sm" : "text-xs"} leading-snug`}>
      <span className="min-w-0 break-words">{rotulo}</span>
      <span className="shrink-0 tabular-nums">
        {sinal && valor !== 0 ? `${sinal} ` : ""}
        {formatCurrency(valor)}
      </span>
    </li>
  );
}

function Assinatura({ de, nome }: { de: string; nome: string }) {
  return (
    <div data-assinatura={de} className="min-w-0 flex flex-col justify-end">
      <div className="border-t border-black pt-0.5 mt-10 text-center text-[11px] leading-tight">
        <p className="font-semibold break-words">{nome}</p>
        <p>{de}</p>
      </div>
    </div>
  );
}

export function FolhaDoDemonstrativo({ recibo }: { recibo: ReciboDoFechamento }) {
  const { empresa, pessoa, conta } = recibo;
  const papel = pessoa.tipo === "motorista" ? "Motorista" : "Ajudante";

  return (
    <article data-recibo className="mx-auto w-full max-w-[190mm] bg-white text-black border border-gray-400 rounded-lg p-3 md:p-5 space-y-2">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b-2 border-black pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SimboloDaEmpresa logo={empresa.logo} tamanho="grande" />
          <p data-empresa className="text-base font-bold leading-tight break-words min-w-0">
            {empresa.name}
          </p>
        </div>
        <div className="text-right ml-auto">
          <h1 className="text-base md:text-lg font-bold leading-tight tracking-wide">{TITULO_DO_DEMONSTRATIVO}</h1>
          <p className="text-sm leading-tight">
            Mês <span data-mes className="font-mono font-semibold tracking-wider">{mesPorExtenso(recibo.mes)}</span>
          </p>
          <p data-emissao className="text-xs leading-tight">
            Emissão: {formatDate(recibo.emitidoEm)}
          </p>
        </div>
      </header>

      <section data-secao="pessoa" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>{papel} (quem recebe)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-x-3 gap-y-0.5">
          <Campo rotulo="Nome" className="col-span-2 sm:col-span-1 print:col-span-1">
            <span data-nome className="font-semibold">{pessoa.nome}</span>
          </Campo>
          <Campo rotulo="CPF">
            <span data-cpf>{formatDocument(pessoa.cpf)}</span>
          </Campo>
          <Campo rotulo="Fechado em">
            {formatDate(recibo.fechadoEm)} · {recibo.fechadoPor}
          </Campo>
          <Campo rotulo="Formas de remuneração" className="col-span-2 sm:col-span-3 print:col-span-3">
            {formasPorExtenso(recibo.formas)}
          </Campo>
        </div>
      </section>

      <section data-secao="viagens" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Viagens finalizadas no mês ({conta.viagens.length})</h2>
        {conta.viagens.length === 0 ? (
          <p className="text-xs leading-snug">Nenhuma viagem finalizada no mês.</p>
        ) : (
          <ul>
            {conta.viagens.map((linha) => (
              <li key={linha.manifestId} data-viagem={linha.manifestId} className="border-t border-dotted border-gray-400 py-0.5 text-xs leading-snug">
                <p className="flex justify-between gap-3">
                  <span className="min-w-0 break-words font-semibold">
                    #{linha.codigo} · {formatCalendarDate(linha.saida)}
                    {linha.finalizada !== linha.saida ? ` a ${formatCalendarDate(linha.finalizada)}` : ""} · {linha.placa}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold">{formatCurrency(linha.total)}</span>
                </p>
                <p className="break-words">
                  {basesPorExtenso(linha)} · frete das entregas {formatCurrency(linha.frete)}
                </p>
                <p className="break-words">{linha.fora === "PARCEIRO" ? EXPLICACAO_DO_PARCEIRO : parcelasPorExtenso(linha) || "Sem forma de remuneração com valor"}</p>
                {linha.semKm && <p className="break-words">{EXPLICACAO_SEM_KM}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-secao="conta" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Remuneração variável do mês</h2>
        <ul>
          {PARCELAS.filter((parcela) => conta.parcelas[parcela] !== 0).map((parcela) => (
            <Linha key={parcela} rotulo={ROTULO_DA_PARCELA[parcela]} valor={conta.parcelas[parcela]} />
          ))}
          <Linha rotulo="Total do variável" valor={conta.variavel} forte />
        </ul>
      </section>

      <section data-secao="adiantamentos" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Adiantamentos e vales descontados</h2>
        {conta.adiantamentos.length === 0 ? (
          <p className="text-xs leading-snug">Nenhum adiantamento ou vale em aberto no mês.</p>
        ) : (
          <ul>
            {conta.adiantamentos.map((adiantamento) => (
              <li key={adiantamento.id} data-adiantamento={adiantamento.id} className="flex justify-between gap-3 border-t border-dotted border-gray-400 text-xs leading-snug">
                <span className="min-w-0 break-words">
                  {formatCalendarDate(adiantamento.date)} · {rotuloDoMotivo(adiantamento.reason)}
                </span>
                <span className="shrink-0 tabular-nums">− {formatCurrency(adiantamento.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-1">
          <Linha rotulo="Total descontado" valor={conta.adiantado} sinal="−" forte />
          <Linha rotulo={conta.saldo < 0 ? "Saldo (a pessoa deve)" : "Saldo a pagar"} valor={Math.abs(conta.saldo)} forte />
        </ul>
      </section>

      {/* O fecho da folha: na impressão, as assinaturas e o rodapé nunca ficam em folhas diferentes. */}
      <div data-fecho className="space-y-2">
        <p className="text-xs leading-snug">
          Declaro que conferi as viagens e os valores acima, referentes à remuneração variável de {mesPorExtenso(recibo.mes)}.
        </p>
        <section data-secao="assinaturas" className="grid grid-cols-2 gap-x-8 gap-y-2 pt-1">
          <Assinatura de={`${papel} (quem recebe)`} nome={pessoa.nome} />
          <Assinatura de="Empresa (quem paga)" nome={empresa.name} />
        </section>

        <footer data-aviso className="border-t-2 border-black pt-1.5 text-center text-xs font-bold">
          {AVISO_DO_DEMONSTRATIVO}
        </footer>
      </div>
    </article>
  );
}
