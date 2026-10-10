"use client";

import { useEffect, useState } from "react";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { diaNoBrasil } from "@/lib/financeiro";
import {
  CHECKLIST_ITENS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABEL,
  SITUACAO_DO_VENCIMENTO_LABEL,
  kmRodadosDoPneu,
  prazoPorExtenso,
  problemasDoChecklist,
  type SituacaoDoVencimento,
  type TipoDeDocumento,
  type Trecho,
} from "@/lib/frota";
import type { DeniedReason } from "../../financeiro/carregar";
import { AbaDeRegistros, ITEM_COM_PROBLEMA, ITEM_OK, type Campo, type Coluna, type Valores } from "./registros";

/**
 * As abas de registro da tela de frota do veículo. Cada uma descreve os campos
 * do formulário e as colunas da lista; o resto é de `AbaDeRegistros`.
 */

export type PropsDaAba = {
  vehicleId: string;
  formAberto: boolean;
  setFormAberto: (aberto: boolean) => void;
  onNegado: (motivo: DeniedReason) => void;
};

const hoje = () => diaNoBrasil(new Date());
const km = (valor: number | null) => (valor === null ? "-" : `${valor.toLocaleString("pt-BR")} km`);
const numero = (valor: number | null, unidade: string) => (valor === null ? "-" : `${valor.toLocaleString("pt-BR")} ${unidade}`);
const texto = (valor: number | null) => (valor === null ? "" : String(valor));

const SELO = "inline-block text-xs px-2.5 py-1 rounded-full";
const SELO_DA_SITUACAO: Record<SituacaoDoVencimento, string> = {
  em_dia: "bg-green-100 text-green-700",
  a_vencer: "bg-yellow-100 text-yellow-800",
  vencido: "bg-red-100 text-red-700",
};

/* --------------------------------- Manutenção -------------------------------- */

type Manutencao = {
  id: string;
  description: string;
  cost: number;
  date: string;
  status: string;
  kind: keyof typeof MAINTENANCE_KIND_LABEL | null;
  odometer: number | null;
};

const SITUACAO_DA_MANUTENCAO: Record<string, { rotulo: string; classe: string }> = {
  COMPLETED: { rotulo: "Concluída", classe: "bg-green-100 text-green-700" },
  IN_PROGRESS: { rotulo: "Em andamento", classe: "bg-yellow-100 text-yellow-800" },
  SCHEDULED: { rotulo: "Agendada", classe: "bg-gray-100 text-gray-700" },
};

const CAMPOS_DA_MANUTENCAO: Campo[] = [
  { chave: "description", rotulo: "Serviço ou peça", obrigatorio: true, largo: true, placeholder: "Troca de óleo, freios…" },
  { chave: "cost", rotulo: "Custo (R$)", tipo: "decimal", obrigatorio: true },
  { chave: "date", rotulo: "Data", tipo: "data", obrigatorio: true },
  { chave: "kind", rotulo: "Tipo", tipo: "opcoes", opcoes: [["", "Não informado"], ...MAINTENANCE_KINDS.map((k) => [k, MAINTENANCE_KIND_LABEL[k]] as const)] },
  { chave: "odometer", rotulo: "Hodômetro (km)", tipo: "inteiro" },
];

const COLUNAS_DA_MANUTENCAO: Coluna<Manutencao>[] = [
  { rotulo: "Serviço ou peça", valor: (m) => m.description, largo: true },
  { rotulo: "Data", valor: (m) => formatCalendarDate(m.date) },
  { rotulo: "Tipo", valor: (m) => (m.kind ? MAINTENANCE_KIND_LABEL[m.kind] : "-") },
  { rotulo: "Hodômetro", valor: (m) => km(m.odometer) },
  { rotulo: "Custo", valor: (m) => formatCurrency(m.cost), direita: true },
  {
    rotulo: "Situação",
    valor: (m) => {
      const situacao = SITUACAO_DA_MANUTENCAO[m.status] ?? SITUACAO_DA_MANUTENCAO.SCHEDULED;
      return <span className={`${SELO} ${situacao.classe}`}>{situacao.rotulo}</span>;
    },
  },
];

export function AbaManutencao({ vehicleId, ...resto }: PropsDaAba) {
  return (
    <AbaDeRegistros<Manutencao>
      {...resto}
      url={`/api/veiculos/${vehicleId}/manutencao`}
      novo="Registrar manutenção"
      salvo="Manutenção registrada."
      vazio="Nenhuma manutenção registrada."
      campos={CAMPOS_DA_MANUTENCAO}
      formVazio={() => ({ description: "", cost: "", date: hoje(), kind: "", odometer: "" })}
      // A tela registra o serviço já feito, como sempre fez.
      paraCorpo={(form) => ({ ...form, status: "COMPLETED" })}
      colunas={COLUNAS_DA_MANUTENCAO}
      nota="Ao salvar, uma despesa é lançada no Financeiro com esta data e valor."
    />
  );
}

/* -------------------------------- Abastecimento ------------------------------ */

type Abastecimento = Trecho & {
  id: string;
  date: string;
  liters: number;
  totalCost: number;
  odometer: number;
  station: string | null;
  driver: { id: string; user: { name: string } } | null;
};

const COLUNAS_DO_ABASTECIMENTO: Coluna<Abastecimento>[] = [
  { rotulo: "Data", valor: (a) => formatCalendarDate(a.date) },
  { rotulo: "Hodômetro", valor: (a) => km(a.odometer) },
  { rotulo: "Litros", valor: (a) => numero(a.liters, "l"), direita: true },
  { rotulo: "Valor", valor: (a) => formatCurrency(a.totalCost), direita: true },
  { rotulo: "Consumo", valor: (a) => numero(a.kmPorLitro, "km/l"), direita: true },
  { rotulo: "Custo por km", valor: (a) => (a.custoPorKm === null ? "-" : formatCurrency(a.custoPorKm)), direita: true },
  { rotulo: "Posto", valor: (a) => a.station || "-" },
  { rotulo: "Motorista", valor: (a) => a.driver?.user.name ?? "-" },
];

export function AbaAbastecimento({ vehicleId, ...resto }: PropsDaAba) {
  const [motoristas, setMotoristas] = useState<(readonly [string, string])[]>([]);

  useEffect(() => {
    let ativo = true;
    // Sem a lista o formulário continua valendo: o motorista é opcional.
    fetch("/api/motoristas")
      .then((res) => (res.ok ? res.json() : []))
      .then((lista: { id: string; user: { name: string } }[]) => {
        if (ativo) setMotoristas(lista.map((m) => [m.id, m.user.name] as const));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  const campos: Campo[] = [
    { chave: "date", rotulo: "Data", tipo: "data", obrigatorio: true },
    { chave: "odometer", rotulo: "Hodômetro (km)", tipo: "inteiro", obrigatorio: true },
    { chave: "liters", rotulo: "Litros", tipo: "decimal", obrigatorio: true },
    { chave: "totalCost", rotulo: "Valor total (R$)", tipo: "decimal", obrigatorio: true },
    { chave: "station", rotulo: "Posto" },
    { chave: "driverId", rotulo: "Motorista", tipo: "opcoes", opcoes: [["", "Não informado"], ...motoristas] },
  ];

  return (
    <AbaDeRegistros<Abastecimento>
      {...resto}
      url={`/api/veiculos/${vehicleId}/abastecimentos`}
      novo="Novo abastecimento"
      salvo="Abastecimento registrado."
      vazio="Nenhum abastecimento registrado."
      campos={campos}
      formVazio={() => ({ date: hoje(), odometer: "", liters: "", totalCost: "", station: "", driverId: "" })}
      colunas={COLUNAS_DO_ABASTECIMENTO}
      excluir={(a) => `Excluir o abastecimento de ${formatCalendarDate(a.date)} (${formatCurrency(a.totalCost)})? Não dá para desfazer.`}
      nota="O consumo é medido de um abastecimento para o seguinte, pelo hodômetro: o primeiro fica sem medição."
    />
  );
}

/* ---------------------------------- Documentos ------------------------------- */

type Documento = {
  id: string;
  type: TipoDeDocumento;
  number: string | null;
  expiresAt: string;
  notes: string | null;
  situacao: SituacaoDoVencimento;
  dias: number;
};

const CAMPOS_DO_DOCUMENTO: Campo[] = [
  { chave: "type", rotulo: "Tipo", tipo: "opcoes", obrigatorio: true, opcoes: DOCUMENT_TYPES.map((t) => [t, DOCUMENT_TYPE_LABEL[t]] as const) },
  { chave: "expiresAt", rotulo: "Vencimento", tipo: "data", obrigatorio: true },
  { chave: "number", rotulo: "Número" },
  { chave: "notes", rotulo: "Observação" },
];

const COLUNAS_DO_DOCUMENTO: Coluna<Documento>[] = [
  { rotulo: "Documento", valor: (d) => DOCUMENT_TYPE_LABEL[d.type] ?? d.type, largo: true },
  { rotulo: "Vencimento", valor: (d) => formatCalendarDate(d.expiresAt) },
  {
    rotulo: "Situação",
    valor: (d) => (
      <span className={`${SELO} ${SELO_DA_SITUACAO[d.situacao]}`} data-situacao={d.situacao}>
        {d.situacao === "em_dia" ? SITUACAO_DO_VENCIMENTO_LABEL.em_dia : prazoPorExtenso(d.dias)}
      </span>
    ),
  },
  { rotulo: "Número", valor: (d) => d.number || "-" },
  { rotulo: "Observação", valor: (d) => d.notes || "-" },
];

export function AbaDocumentos({ vehicleId, ...resto }: PropsDaAba) {
  return (
    <AbaDeRegistros<Documento>
      {...resto}
      url={`/api/veiculos/${vehicleId}/documentos`}
      novo="Novo documento"
      salvo="Documento registrado."
      vazio="Nenhum documento registrado."
      campos={CAMPOS_DO_DOCUMENTO}
      formVazio={() => ({ type: DOCUMENT_TYPES[0], expiresAt: "", number: "", notes: "" })}
      colunas={COLUNAS_DO_DOCUMENTO}
      editar={{
        campos: CAMPOS_DO_DOCUMENTO,
        paraForm: (d) => ({ type: d.type, expiresAt: d.expiresAt.slice(0, 10), number: d.number ?? "", notes: d.notes ?? "" }),
      }}
      excluir={(d) => `Excluir o documento "${DOCUMENT_TYPE_LABEL[d.type] ?? d.type}"? Não dá para desfazer.`}
      nota="Avisa 30 dias antes do vencimento. Ao renovar, edite o documento e troque o vencimento."
    />
  );
}

/* ------------------------------------ Pneus ---------------------------------- */

type Pneu = {
  id: string;
  position: string;
  brandModel: string;
  installedAt: string;
  installedKm: number;
  removedKm: number | null;
  notes: string | null;
};

const CAMPOS_QUE_MUDAM_NO_PNEU: Campo[] = [
  { chave: "position", rotulo: "Posição", obrigatorio: true, placeholder: "Dianteiro esquerdo" },
  { chave: "brandModel", rotulo: "Marca e modelo", obrigatorio: true },
  { chave: "removedKm", rotulo: "Km de retirada", tipo: "inteiro", placeholder: "Em branco: em uso" },
  { chave: "notes", rotulo: "Observação" },
];

const CAMPOS_DO_PNEU: Campo[] = [
  ...CAMPOS_QUE_MUDAM_NO_PNEU.slice(0, 2),
  { chave: "installedAt", rotulo: "Instalação", tipo: "data", obrigatorio: true },
  { chave: "installedKm", rotulo: "Km de instalação", tipo: "inteiro", obrigatorio: true },
  ...CAMPOS_QUE_MUDAM_NO_PNEU.slice(2),
];

const COLUNAS_DO_PNEU: Coluna<Pneu>[] = [
  { rotulo: "Posição", valor: (p) => p.position },
  { rotulo: "Marca e modelo", valor: (p) => p.brandModel },
  { rotulo: "Instalação", valor: (p) => `${formatCalendarDate(p.installedAt)} · ${km(p.installedKm)}` },
  {
    rotulo: "Retirada",
    valor: (p) =>
      p.removedKm === null ? (
        <span className={`${SELO} bg-green-100 text-green-700`}>Em uso</span>
      ) : (
        `${km(p.removedKm)} (rodou ${km(kmRodadosDoPneu(p))})`
      ),
  },
  { rotulo: "Observação", valor: (p) => p.notes || "-" },
];

export function AbaPneus({ vehicleId, ...resto }: PropsDaAba) {
  return (
    <AbaDeRegistros<Pneu>
      {...resto}
      url={`/api/veiculos/${vehicleId}/pneus`}
      novo="Novo pneu"
      salvo="Pneu registrado."
      vazio="Nenhum pneu registrado."
      campos={CAMPOS_DO_PNEU}
      formVazio={() => ({ position: "", brandModel: "", installedAt: hoje(), installedKm: "", removedKm: "", notes: "" })}
      colunas={COLUNAS_DO_PNEU}
      editar={{
        campos: CAMPOS_QUE_MUDAM_NO_PNEU,
        paraForm: (p) => ({ position: p.position, brandModel: p.brandModel, removedKm: texto(p.removedKm), notes: p.notes ?? "" }),
      }}
      excluir={(p) => `Excluir o pneu "${p.brandModel}" (${p.position})? Não dá para desfazer.`}
      nota="Registro simples, sem estoque. Para dar baixa, edite o pneu e informe o km de retirada."
    />
  );
}

/* ---------------------------------- Checklist -------------------------------- */

type Checklist = {
  id: string;
  date: string;
  odometer: number | null;
  items: unknown;
  notes: string | null;
  user: { name: string } | null;
};

const dataEHora = (valor: string) => new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const CAMPOS_DO_CHECKLIST: Campo[] = [
  ...CHECKLIST_ITENS.map((item): Campo => ({ chave: item.chave, rotulo: item.rotulo, tipo: "item" })),
  { chave: "odometer", rotulo: "Hodômetro (km)", tipo: "inteiro" },
  { chave: "notes", rotulo: "Observação" },
];

const checklistVazio = (): Valores => ({
  ...Object.fromEntries(CHECKLIST_ITENS.map((item) => [item.chave, ITEM_OK])),
  odometer: "",
  notes: "",
});

/** O corpo que as rotas de checklist esperam: um booleano por item (true = OK). */
const corpoDoChecklist = (form: Valores) => ({
  items: Object.fromEntries(CHECKLIST_ITENS.map((item) => [item.chave, form[item.chave] !== ITEM_COM_PROBLEMA])),
  odometer: form.odometer ?? "",
  notes: form.notes ?? "",
});

const COLUNAS_DO_CHECKLIST: Coluna<Checklist>[] = [
  {
    rotulo: "Resultado",
    largo: true,
    valor: (c) => {
      const problemas = problemasDoChecklist(c.items);
      return problemas.length === 0 ? (
        <span className={`${SELO} bg-green-100 text-green-700`}>Tudo OK</span>
      ) : (
        <span className={`${SELO} bg-red-100 text-red-700`} data-problemas={problemas.length}>
          Problema: {problemas.join(", ")}
        </span>
      );
    },
  },
  { rotulo: "Data", valor: (c) => dataEHora(c.date) },
  { rotulo: "Quem fez", valor: (c) => c.user?.name ?? "-" },
  { rotulo: "Hodômetro", valor: (c) => km(c.odometer) },
  { rotulo: "Observação", valor: (c) => c.notes || "-" },
];

export function AbaChecklist({ vehicleId, ...resto }: PropsDaAba) {
  return (
    <AbaDeRegistros<Checklist>
      {...resto}
      url={`/api/veiculos/${vehicleId}/checklists`}
      novo="Novo checklist"
      salvo="Checklist registrado."
      vazio="Nenhum checklist registrado."
      campos={CAMPOS_DO_CHECKLIST}
      formVazio={checklistVazio}
      paraCorpo={corpoDoChecklist}
      colunas={COLUNAS_DO_CHECKLIST}
      nota="Toque no item para marcar problema. O motorista também registra pelo app, na viagem."
    />
  );
}
