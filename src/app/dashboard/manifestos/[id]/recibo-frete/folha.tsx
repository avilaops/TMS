import type { ReactNode } from "react";
import { SimboloDaEmpresa } from "@/components/empresa/identidade";
import { formatCalendarDate, formatCurrency, formatDate, formatDocument, MANIFEST_STATUS, statusBadge } from "@/lib/format";
import {
  AVISO_DAS_RETENCOES,
  AVISO_DO_RECIBO,
  TITULO_DO_RECIBO,
  rotuloDaForma,
  rotuloDaFormaDePagamento,
  rotuloDaSituacao,
  rotuloDoPagamento,
  type ReciboDeFrete,
} from "@/lib/frete-contratado";
import { chaveEmBlocos } from "@/lib/minuta";
import { rotuloDoTipo } from "@/lib/parceiros";

/**
 * A folha do recibo de pagamento de frete: uma A4 em retrato, em preto e
 * branco, no molde da minuta de despacho (../../../coletas/[id]/minuta/folha.tsx).
 * Só desenha o que a rota entregou (`GET /api/manifestos/[id]/frete/recibo`).
 *
 * Não é documento fiscal: não tem número de RPA nem de CIOT, e o rodapé diz
 * isso. As retenções aparecem como foram digitadas.
 */

// No papel só a folha sai: o menu, o cabeçalho do painel e os botões ficam
// invisíveis, e a folha sobe para o canto da página. Vale só nesta página.
export const ESTILO_DE_IMPRESSAO = `
@media print {
  body * { visibility: hidden; }
  [data-recibo], [data-recibo] * { visibility: visible; }
  [data-recibo] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  [data-recibo] section { break-inside: avoid; page-break-inside: avoid; }
  /* Os pagamentos podem não caber numa folha: quebram entre linhas. */
  [data-recibo] section[data-secao="pagamentos"] { break-inside: auto; page-break-inside: auto; orphans: 3; widows: 3; }
  [data-recibo] [data-pagamento] { break-inside: avoid; page-break-inside: avoid; }
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

/** Rótulo em cima, valor embaixo. Sem valor, a linha fica em branco, com a altura de uma linha escrita. */
function Campo({ rotulo, children, className = "" }: { rotulo: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className={ROTULO}>{rotulo}</p>
      <p className="text-sm leading-snug break-words min-h-5">{children}</p>
    </div>
  );
}

/** Uma linha da conta: o que é, à esquerda; quanto, à direita. */
function Linha({ rotulo, valor, forte = false, sinal = "" }: { rotulo: string; valor: number; forte?: boolean; sinal?: "" | "+" | "−" }) {
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

export function FolhaDoRecibo({ recibo }: { recibo: ReciboDeFrete }) {
  const { empresa, parceiro, viagem, contrato, valores, pagamentos } = recibo;

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
          <h1 className="text-lg font-bold leading-tight tracking-wide">{TITULO_DO_RECIBO}</h1>
          <p className="text-sm leading-tight">
            Viagem <span data-codigo className="font-mono font-semibold tracking-wider">#{viagem.codigo}</span>
          </p>
          <p data-emissao className="text-xs leading-tight">
            Emissão: {formatDate(recibo.emitidoEm)}
          </p>
        </div>
      </header>

      <section data-secao="parceiro" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Parceiro (quem recebe)</h2>
        <p className="text-sm font-semibold leading-snug break-words">{parceiro.nome}</p>
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-0.5">
          <Campo rotulo="CPF / CNPJ">{formatDocument(parceiro.documento)}</Campo>
          <Campo rotulo="RNTRC">{parceiro.rntrc}</Campo>
          <Campo rotulo="Tipo">{rotuloDoTipo(parceiro.tipo)}</Campo>
        </div>
      </section>

      <section data-secao="viagem" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Viagem</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-x-3 gap-y-0.5">
          <Campo rotulo="Veículo">
            {viagem.placa} · {viagem.veiculo}
          </Campo>
          <Campo rotulo="Motorista">{viagem.motorista}</Campo>
          <Campo rotulo="Situação">{statusBadge(MANIFEST_STATUS, viagem.situacao).label}</Campo>
          <Campo rotulo="Saída">{viagem.saiuEm ? formatDate(viagem.saiuEm) : null}</Campo>
          <Campo rotulo="Finalizada em">{viagem.finalizadaEm ? formatDate(viagem.finalizadaEm) : null}</Campo>
          <Campo rotulo="Forma do frete">{rotuloDaForma(contrato.forma)}</Campo>
          <Campo rotulo="Origem" className="col-span-2 sm:col-span-3 print:col-span-3">
            {viagem.origens.join(" · ")}
          </Campo>
          <Campo rotulo="Destinos" className="col-span-2 sm:col-span-3 print:col-span-3">
            {viagem.destinos.join(" · ")}
          </Campo>
        </div>
      </section>

      <section data-secao="valores" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Frete contratado · {rotuloDaSituacao(contrato.situacao)}</h2>
        <ul>
          <Linha rotulo="Valor bruto" valor={valores.bruto} />
          <Linha rotulo="Pedágio pago à parte" valor={contrato.tollAmount} sinal="+" />
          <Linha rotulo="Outros acréscimos" valor={contrato.otherAdditions} sinal="+" />
          <Linha rotulo="Descontos" valor={valores.descontos} sinal="−" />
          <Linha rotulo="INSS retido" valor={contrato.inss} sinal="−" />
          <Linha rotulo="IRRF retido" valor={contrato.irrf} sinal="−" />
          <Linha rotulo="SEST/SENAT retido" valor={contrato.sestSenat} sinal="−" />
          <Linha rotulo="Outras retenções" valor={contrato.otherWithholdings} sinal="−" />
          <Linha rotulo="Valor líquido" valor={valores.liquido} forte />
        </ul>
        <p className="text-[10px] text-gray-700 leading-tight mt-1">{AVISO_DAS_RETENCOES}</p>
        {contrato.observacao && <p className="text-xs leading-snug break-words mt-1">Observação: {contrato.observacao}</p>}
      </section>

      <section data-secao="pagamentos" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Pagamentos feitos</h2>
        {pagamentos.length === 0 ? (
          <p className="text-xs leading-snug">Nenhum pagamento registrado.</p>
        ) : (
          <ul>
            {pagamentos.map((pagamento) => (
              <li key={pagamento.id} data-pagamento={pagamento.id} className="flex justify-between gap-3 border-t border-dotted border-gray-400 text-xs leading-snug">
                <span className="min-w-0 break-words">
                  {formatCalendarDate(pagamento.date)} · {rotuloDoPagamento(pagamento.kind)} · {rotuloDaFormaDePagamento(pagamento.method)}
                  {pagamento.notes ? ` · ${pagamento.notes}` : ""}
                </span>
                <span className="shrink-0 tabular-nums">{formatCurrency(pagamento.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-1">
          <Linha rotulo="Total pago" valor={recibo.pago} forte />
          <Linha rotulo={recibo.saldo < 0 ? "Pago a mais" : "Saldo a pagar"} valor={Math.abs(recibo.saldo)} forte />
        </ul>
      </section>

      {/* Só em contrato com transportadora: os documentos que ela emitiu para a viagem. */}
      {recibo.subcontratacao && (
        <section data-secao="subcontratacao" className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Documentos da subcontratada</h2>
          {recibo.subcontratacao.documentos.length === 0 ? (
            <p className="text-xs leading-snug">Nenhum CT-e ou MDF-e da subcontratada registrado.</p>
          ) : (
            <ul>
              {recibo.subcontratacao.documentos.map((documento) => (
                <li key={documento.id} data-documento={documento.chave} className="border-t border-dotted border-gray-400 text-xs leading-snug">
                  {documento.tipo === "MDFE" ? `MDF-e · descarga em ${documento.uf}` : `CT-e · carga ${documento.carga}`} · {formatCalendarDate(documento.data)}
                  <span className="block font-mono text-[10px] break-all">{chaveEmBlocos(documento.chave)}</span>
                </li>
              ))}
            </ul>
          )}
          {recibo.subcontratacao.cargasSemCte.length > 0 && (
            <p data-sem-cte className="text-[10px] text-gray-700 leading-tight mt-1">
              Sem CT-e da subcontratada: {recibo.subcontratacao.cargasSemCte.join(", ")}.
            </p>
          )}
        </section>
      )}

      {/* O fecho da folha: na impressão, as assinaturas e o rodapé nunca ficam em folhas diferentes. */}
      <div data-fecho className="space-y-2">
        <p className="text-xs leading-snug">
          Declaro que recebi de {empresa.name} os pagamentos relacionados acima, referentes ao frete da viagem #{viagem.codigo}.
        </p>
        <section data-secao="assinaturas" className="grid grid-cols-2 gap-x-8 gap-y-2 pt-1">
          <Assinatura de="Parceiro (quem recebe)" nome={parceiro.nome} />
          <Assinatura de="Empresa (quem paga)" nome={empresa.name} />
        </section>

        <footer data-aviso className="border-t-2 border-black pt-1.5 text-center text-xs font-bold">
          {AVISO_DO_RECIBO}
        </footer>
      </div>
    </article>
  );
}
