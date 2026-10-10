import type { ReactNode } from "react";
import { SimboloDaEmpresa } from "@/components/empresa/identidade";
import { formatCurrency, formatDocument, formatWeight } from "@/lib/format";
import { AVISO_SEM_VALOR_FISCAL, TITULO_DA_MINUTA, chaveEmBlocos, dataDeEmissao, type Minuta, type ParteDaMinuta } from "@/lib/minuta";
import { CodigoDeBarras } from "../../../deposito/comum";

/**
 * A folha da minuta de despacho: uma A4 em retrato, em preto e branco. Só
 * desenha o que `montarMinuta` (src/lib/minuta.ts) entregou: seção que veio
 * `null` não aparece, e campo vazio fica em branco para preencher à mão.
 */

// No papel só a folha sai: o menu, o cabeçalho do painel e os botões ficam
// invisíveis, e a folha sobe para o canto da página. Vale só nesta página.
export const ESTILO_DE_IMPRESSAO = `
@media print {
  body * { visibility: hidden; }
  [data-minuta], [data-minuta] * { visibility: visible; }
  [data-minuta] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  [data-minuta] section { break-inside: avoid; }
  /* O símbolo padrão é um desenho branco sobre fundo de cor: sem isto o navegador tira o fundo e ele some. */
  [data-minuta] header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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

function Parte({ titulo, secao, parte, cidade }: { titulo: string; secao: string; parte: ParteDaMinuta; cidade?: { rotulo: string; nome: string } }) {
  return (
    <section data-secao={secao} className={SECAO}>
      <h2 className={TITULO_DA_SECAO}>{titulo}</h2>
      <p className="text-sm font-semibold leading-snug break-words">{parte.nome}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-0.5">
        <Campo rotulo="CNPJ / CPF">{parte.documento ? formatDocument(parte.documento) : null}</Campo>
        {cidade && <Campo rotulo={cidade.rotulo}>{cidade.nome}</Campo>}
        <Campo rotulo="Endereço" className="col-span-2">
          {parte.endereco}
        </Campo>
      </div>
    </section>
  );
}

/** Onde se assina. O recebedor escreve também o nome, o documento, a data e a hora. */
function Assinatura({ de, completa = false }: { de: string; completa?: boolean }) {
  return (
    <div data-assinatura={de} className="min-w-0 flex flex-col justify-end">
      {completa && (
        <div className="space-y-2.5 mb-2 text-[11px]">
          <p className="border-b border-gray-500 leading-tight">Nome:</p>
          <p className="border-b border-gray-500 leading-tight">Documento:</p>
          <div className="grid grid-cols-2 gap-x-3">
            <p className="border-b border-gray-500 leading-tight">Data:</p>
            <p className="border-b border-gray-500 leading-tight">Hora:</p>
          </div>
        </div>
      )}
      <div className="border-t border-black pt-0.5 mt-8 text-center text-[11px] leading-tight">Assinatura: {de}</div>
    </div>
  );
}

export function FolhaDaMinuta({ minuta }: { minuta: Minuta }) {
  const { empresa, pagador, remetente, destinatario, carga, notas, frete, viagem, motorista, cte } = minuta;

  return (
    <article data-minuta className="mx-auto w-full max-w-[190mm] bg-white text-black border border-gray-400 rounded-lg p-3 md:p-5 space-y-2">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b-2 border-black pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SimboloDaEmpresa logo={empresa.logo} tamanho="grande" />
          <p data-empresa className="text-base font-bold leading-tight break-words min-w-0">
            {empresa.name}
          </p>
        </div>
        <div className="text-right ml-auto">
          <h1 className="text-lg font-bold leading-tight tracking-wide">{TITULO_DA_MINUTA}</h1>
          {minuta.codigo && (
            <p className="text-sm leading-tight">
              Nº <span data-codigo className="font-mono font-semibold tracking-wider">{minuta.codigo}</span>
            </p>
          )}
          <p data-emissao className="text-xs leading-tight">
            Emissão: {dataDeEmissao(minuta.emitidaEm)}
          </p>
        </div>
      </header>

      {minuta.codigo && (
        <div className="flex justify-center">
          <CodigoDeBarras texto={minuta.codigo} className="h-10 w-full max-w-xs" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-2">
        <Parte titulo="Remetente" secao="remetente" parte={remetente} cidade={{ rotulo: "Origem", nome: remetente.cidade }} />
        <Parte titulo="Destinatário" secao="destinatario" parte={destinatario} cidade={{ rotulo: "Destino", nome: destinatario.cidade }} />
      </div>

      <Parte titulo="Cliente pagador" secao="pagador" parte={pagador} />

      <section data-secao="carga" className={SECAO}>
        <h2 className={TITULO_DA_SECAO}>Carga</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-x-3 gap-y-0.5">
          <Campo rotulo="Volumes">{carga.volumes}</Campo>
          <Campo rotulo="Peso">{formatWeight(carga.peso)}</Campo>
          <Campo rotulo="Cubagem">{carga.cubagem === null ? null : `${carga.cubagem.toLocaleString("pt-BR")} m³`}</Campo>
          <Campo rotulo="Valor da mercadoria">{carga.valorDaMercadoria === null ? null : formatCurrency(carga.valorDaMercadoria)}</Campo>
        </div>
        {notas.map((nota) => (
          <p key={nota.chave} data-nota={nota.chave} className="text-xs leading-snug break-words mt-0.5">
            <span className="font-semibold">NF-e{nota.numero ? ` ${nota.numero}` : ""}:</span> <span className="font-mono">{chaveEmBlocos(nota.chave)}</span>
          </p>
        ))}
      </section>

      {frete && (
        <section data-secao="frete" className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Frete</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <Campo rotulo="Valor do frete">
              {frete.valor === null ? "A cotar" : `${formatCurrency(frete.valor)}${frete.manual ? " (informado à mão)" : ""}`}
            </Campo>
            <Campo rotulo="Condição de pagamento">{frete.condicaoDePagamento}</Campo>
          </div>
          {frete.composicao.length > 0 && (
            <ul data-composicao className="mt-0.5 text-xs leading-snug">
              {frete.composicao.map((parcela) => (
                <li key={parcela.rotulo} className="flex justify-between gap-3 border-t border-dotted border-gray-400">
                  <span className="min-w-0 break-words">{parcela.rotulo}</span>
                  <span className="shrink-0 tabular-nums">{formatCurrency(parcela.valor)}</span>
                </li>
              ))}
            </ul>
          )}
          {frete.tabela && <p className="text-[11px] text-gray-700 leading-tight mt-0.5">Tabela: {frete.tabela}</p>}
        </section>
      )}

      {(viagem || motorista) && (
        <section data-secao="viagem" className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Viagem</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-x-3 gap-y-0.5">
            {viagem && <Campo rotulo="Viagem">#{viagem.codigo}</Campo>}
            {viagem && (
              <Campo rotulo="Veículo">
                {viagem.placa} · {viagem.veiculo}
              </Campo>
            )}
            <Campo rotulo="Motorista">{motorista}</Campo>
          </div>
        </section>
      )}

      {cte && (
        <section data-secao="cte" className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>CT-e</h2>
          <p className="text-xs leading-snug break-words">
            {cte.numero !== null && <span className="font-semibold">Nº {cte.numero}: </span>}
            <span className="font-mono">{chaveEmBlocos(cte.chave)}</span>
          </p>
        </section>
      )}

      {minuta.observacoes && (
        <section data-secao="observacoes" className={SECAO}>
          <h2 className={TITULO_DA_SECAO}>Observações</h2>
          <p className="text-sm leading-snug break-words whitespace-pre-line">{minuta.observacoes}</p>
        </section>
      )}

      <section data-secao="assinaturas" className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-x-5 gap-y-2 pt-1">
        <Assinatura de="Remetente" />
        <Assinatura de="Motorista" />
        <Assinatura de="Recebedor" completa />
      </section>

      <footer data-aviso className="border-t-2 border-black pt-1.5 text-center text-xs font-bold">
        {AVISO_SEM_VALOR_FISCAL}
      </footer>
    </article>
  );
}
