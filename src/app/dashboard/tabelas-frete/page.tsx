"use client";

import { useEffect, useState } from "react";
import { Calculator, Loader2, Plus, Star, Upload } from "lucide-react";
import { formatCurrency } from "@/lib/format";

/**
 * Tabelas de frete: as regras gerais de cada tabela, o preço por cidade e o
 * simulador. Criar e alterar é do administrador (a API recusa os demais);
 * quem é da operação consulta e simula.
 */

type Tabela = {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  validFrom: string | null;
  validTo: string | null;
  includedWeightKg: number;
  excessPerKg: number;
  cubageFactor: number | null;
  invoiceLimit: number | null;
  adValoremPct: number | null;
  maxVolumes: number | null;
  redeliveryPct: number | null;
  returnPct: number | null;
  notes: string | null;
  _count: { cities: number; clients: number };
};

type Cidade = { city: string; minimum: number; deadlineHours: number; dedicated: boolean };

type Frete =
  | { atendida: false }
  | { atendida: true; cidade: string; valor: number; prazoHoras: number; composicao: { rotulo: string; valor: number }[]; avisos: string[] };

const FORM_VAZIO = {
  name: "",
  includedWeightKg: "",
  excessPerKg: "",
  cubageFactor: "",
  invoiceLimit: "",
  adValoremPct: "",
  maxVolumes: "",
  redeliveryPct: "",
  returnPct: "",
  validFrom: "",
  validTo: "",
  notes: "",
  isDefault: false,
  active: true,
};

const texto = (valor: number | null) => (valor == null ? "" : String(valor).replace(".", ","));
const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

const paraForm = (t: Tabela): typeof FORM_VAZIO => ({
  name: t.name,
  includedWeightKg: texto(t.includedWeightKg),
  excessPerKg: texto(t.excessPerKg),
  cubageFactor: texto(t.cubageFactor),
  invoiceLimit: texto(t.invoiceLimit),
  adValoremPct: texto(t.adValoremPct),
  maxVolumes: texto(t.maxVolumes),
  redeliveryPct: texto(t.redeliveryPct),
  returnPct: texto(t.returnPct),
  validFrom: dia(t.validFrom),
  validTo: dia(t.validTo),
  notes: t.notes ?? "",
  isDefault: t.isDefault,
  active: t.active,
});

const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const LABEL = "text-xs md:text-sm leading-tight font-medium text-gray-700 dark:text-gray-300";
// No celular os campos vão dois por linha; o rótulo que quebra em duas linhas não desalinha o campo do vizinho.
const CAMPO = "min-w-0 flex flex-col justify-end gap-0.5 md:gap-1.5";
const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

/**
 * Lê a lista colada: uma cidade por linha, `Cidade;Mínimo;Prazo` (também aceita
 * tabulação, que é o que vem ao copiar da planilha). O prazo pode vir como
 * "24", "Até 24h" ou "48 horas"; "dedicado" em qualquer coluna marca a cidade.
 * Linha de cabeçalho ou sem valor é devolvida em `ignoradas`, para o operador ver.
 */
function lerColagem(colado: string): { cidades: Cidade[]; ignoradas: string[] } {
  const cidades: Cidade[] = [];
  const ignoradas: string[] = [];

  for (const bruta of colado.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    const partes = linha.split(/[;\t]/).map((p) => p.trim());
    const nome = (partes[0] ?? "").replace(/\s*\(dedicado\)\s*/i, "").trim();
    const minimo = Number((partes[1] ?? "").replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    const prazo = Number((partes[2] ?? "").match(/\d+/)?.[0] ?? "24");

    if (!nome || partes[1] === undefined || partes[1] === "" || !Number.isFinite(minimo)) {
      ignoradas.push(linha);
      continue;
    }
    cidades.push({ city: nome, minimum: minimo, deadlineHours: prazo || 24, dedicated: /dedicad/i.test(linha) });
  }
  return { cidades, ignoradas };
}

export default function TabelasDeFrete() {
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [podeAlterar, setPodeAlterar] = useState(true);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  // Formulário das regras.
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  // Cidades da tabela aberta.
  const [aberta, setAberta] = useState<Tabela | null>(null);
  const [cidades, setCidades] = useState<Cidade[]>([]);
  const [colado, setColado] = useState("");
  const [ignoradas, setIgnoradas] = useState<string[]>([]);

  // Simulador.
  const [sim, setSim] = useState({ city: "", weight: "", volumes: "", invoiceValue: "", cubicMeters: "", tableId: "" });
  const [resultado, setResultado] = useState<{ tabela: { name: string }; frete: Frete } | null>(null);
  const [erroSim, setErroSim] = useState("");

  const carregar = async () => {
    try {
      const res = await fetch("/api/tabelas-frete");
      if (res.ok) setTabelas(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const erroDe = async (res: Response, padrao: string) => {
    if (res.status === 403) {
      setPodeAlterar(false);
      return "Só o administrador altera tabelas de frete.";
    }
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? padrao;
  };

  const abrirNova = () => {
    setEditandoId(null);
    setForm(FORM_VAZIO);
    setFormAberto(true);
    setMensagem(null);
  };

  const abrirEdicao = (t: Tabela) => {
    setEditandoId(t.id);
    setForm(paraForm(t));
    setFormAberto(true);
    setMensagem(null);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMensagem(null);
    try {
      const { active, ...resto } = form;
      const res = await fetch(editandoId ? `/api/tabelas-frete/${editandoId}` : "/api/tabelas-frete", {
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editandoId ? { ...resto, active } : resto),
      });
      if (res.ok) {
        setFormAberto(false);
        setMensagem({ ok: true, texto: editandoId ? "Tabela alterada." : "Tabela criada. Agora informe as cidades." });
        await carregar();
      } else {
        setMensagem({ ok: false, texto: await erroDe(res, "Erro ao salvar a tabela.") });
      }
    } catch {
      setMensagem({ ok: false, texto: "Erro ao salvar a tabela." });
    } finally {
      setSalvando(false);
    }
  };

  const abrirCidades = async (t: Tabela) => {
    setMensagem(null);
    setColado("");
    setIgnoradas([]);
    const res = await fetch(`/api/tabelas-frete/${t.id}`);
    if (!res.ok) return setMensagem({ ok: false, texto: "Não foi possível abrir as cidades." });
    const dados = (await res.json()) as Tabela & { cities: Cidade[] };
    setAberta(dados);
    setCidades(dados.cities);
  };

  const aplicarColagem = () => {
    const lido = lerColagem(colado);
    setCidades(lido.cidades);
    setIgnoradas(lido.ignoradas);
  };

  const gravarCidades = async () => {
    if (!aberta) return;
    setSalvando(true);
    setMensagem(null);
    try {
      const res = await fetch(`/api/tabelas-frete/${aberta.id}/cidades`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities: cidades }),
      });
      if (res.ok) {
        setCidades(await res.json());
        setColado("");
        setIgnoradas([]);
        setMensagem({ ok: true, texto: `Cidades de "${aberta.name}" gravadas.` });
        await carregar();
      } else {
        setMensagem({ ok: false, texto: await erroDe(res, "Erro ao gravar as cidades.") });
      }
    } catch {
      setMensagem({ ok: false, texto: "Erro ao gravar as cidades." });
    } finally {
      setSalvando(false);
    }
  };

  const mudarCidade = (i: number, campo: keyof Cidade, valor: string | boolean) =>
    setCidades((atual) =>
      atual.map((c, j) =>
        j !== i
          ? c
          : {
              ...c,
              [campo]:
                campo === "minimum" || campo === "deadlineHours" ? Number(String(valor).replace(",", ".")) || 0 : valor,
            },
      ),
    );

  const simular = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroSim("");
    setResultado(null);
    const res = await fetch("/api/tabelas-frete/calcular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sim, tableId: sim.tableId || null }),
    });
    const corpo = await res.json().catch(() => ({}));
    if (res.ok) setResultado(corpo);
    else setErroSim(corpo.error ?? "Não foi possível simular.");
  };

  // `largo`: o campo ocupa a linha inteira no celular (no computador segue uma coluna).
  const campo = (rotulo: string, chave: keyof typeof FORM_VAZIO, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, largo = false) => (
    <label className={largo ? `${CAMPO} col-span-2 lg:col-span-1` : CAMPO}>
      <span className={LABEL}>{rotulo}</span>
      <input
        {...extra}
        value={form[chave] as string}
        onChange={(e) => setForm({ ...form, [chave]: e.target.value })}
        className={INPUT}
      />
    </label>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Com o formulário aberto, o celular fica só com ele: é o que cabe numa tela. */}
      <div className={`${formAberto ? "hidden md:flex" : "flex"} flex-wrap justify-between items-center gap-3 md:gap-4`}>
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Tabelas de frete</h1>
          <p className="text-gray-500 text-sm mt-1">Regras, preço por cidade e simulação de frete</p>
        </div>
        {podeAlterar && (
          <button
            onClick={abrirNova}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Nova tabela</span>
          </button>
        )}
      </div>

      {mensagem && (
        <p role="status" className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      {formAberto && (
        <form onSubmit={salvar} className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-5`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{editandoId ? "Alterar tabela" : "Nova tabela"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-3">
            {campo("Nome", "name", { required: true }, true)}
            {campo("Peso do frete mínimo (kg)", "includedWeightKg", { required: true, inputMode: "decimal" })}
            {campo("Kg excedente (R$)", "excessPerKg", { required: true, inputMode: "decimal" })}
            {campo("Cubagem (kg/m³)", "cubageFactor", { inputMode: "decimal", placeholder: "Vazio = não cuba" })}
            {campo("Nota coberta até (R$)", "invoiceLimit", { inputMode: "decimal", placeholder: "Vazio = sem limite" })}
            {campo("% da nota acima disso", "adValoremPct", { inputMode: "decimal", placeholder: "Vazio = consultar" })}
            {campo("Máximo de volumes", "maxVolumes", { inputMode: "numeric" })}
            {campo("Reentrega (% frete)", "redeliveryPct", { inputMode: "decimal" })}
            {campo("Devolução (% frete)", "returnPct", { inputMode: "decimal" })}
            {campo("Vale a partir de", "validFrom", { type: "date" })}
            {campo("Vale até", "validTo", { type: "date" })}
          </div>
          <label className={CAMPO}>
            <span className={LABEL}>Observações</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={1}
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Tabela padrão (substitui a atual)
            </label>
            {editandoId && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Ativa
              </label>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={salvando}
              className="px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2"
            >
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${CARD} overflow-hidden`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : tabelas.length === 0 ? (
          <div className="p-6 md:p-10 text-center text-gray-500">
            <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p>Nenhuma tabela de frete cadastrada. Sem tabela padrão, as cotações do site chegam sem valor.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-6 py-4 font-medium">Tabela</th>
                  <th className="px-6 py-4 font-medium">Regra</th>
                  <th className="px-6 py-4 font-medium">Cidades</th>
                  <th className="px-6 py-4 font-medium">Clientes</th>
                  <th className="px-6 py-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {tabelas.map((t) => (
                  <tr key={t.id}>
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        {t.name}
                        {t.isDefault && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            <Star className="w-3 h-3" /> padrão
                          </span>
                        )}
                        {!t.active && <span className="text-xs text-red-600">inativa</span>}
                      </p>
                      {(t.validFrom || t.validTo) && (
                        <p className="text-xs text-gray-500">
                          {t.validFrom ? `de ${dia(t.validFrom).split("-").reverse().join("/")}` : ""}{" "}
                          {t.validTo ? `até ${dia(t.validTo).split("-").reverse().join("/")}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                      Mínimo até {texto(t.includedWeightKg)} kg · {formatCurrency(t.excessPerKg)}/kg excedente
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{t._count.cities}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{t._count.clients}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap space-x-4">
                      <button onClick={() => void abrirCidades(t)} className="text-blue-600 hover:underline">
                        Cidades
                      </button>
                      {podeAlterar && (
                        <button onClick={() => abrirEdicao(t)} className="text-blue-600 hover:underline">
                          Alterar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aberta && (
        <div className={`${CARD} p-4 md:p-6 space-y-4 md:space-y-5`}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">Cidades de “{aberta.name}”</h2>
            <button onClick={() => setAberta(null)} className="text-sm text-gray-600 dark:text-gray-300">
              Fechar
            </button>
          </div>

          {podeAlterar && (
            <div className="space-y-2">
              <label htmlFor="colagem" className={LABEL}>
                Colar da planilha (uma cidade por linha: Cidade; Mínimo; Prazo em horas)
              </label>
              <textarea
                id="colagem"
                value={colado}
                onChange={(e) => setColado(e.target.value)}
                rows={4}
                placeholder={"Mirassol;50,00;24\nCatanduva;60,00;Até 48h"}
                className={`${INPUT} font-mono`}
              />
              <button
                type="button"
                onClick={aplicarColagem}
                disabled={!colado.trim()}
                className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Substituir a lista abaixo pelo que foi colado
              </button>
              {ignoradas.length > 0 && (
                <p role="alert" className="text-sm text-amber-700">
                  {ignoradas.length} linha(s) sem valor ficaram de fora: {ignoradas.slice(0, 3).join(" | ")}
                  {ignoradas.length > 3 ? " …" : ""}
                </p>
              )}
            </div>
          )}

          {cidades.length === 0 ? (
            <p className="text-sm text-gray-500">Esta tabela ainda não tem cidades.</p>
          ) : (
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left sticky top-0">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cidade</th>
                    <th className="px-4 py-3 font-medium">Frete mínimo (R$)</th>
                    <th className="px-4 py-3 font-medium">Prazo (horas)</th>
                    <th className="px-4 py-3 font-medium">Dedicado</th>
                    {podeAlterar && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {cidades.map((c, i) => (
                    <tr key={`${c.city}-${i}`}>
                      <td className="px-4 py-2 text-gray-900 dark:text-white">{c.city}</td>
                      <td className="px-4 py-2">
                        <input
                          aria-label={`Frete mínimo de ${c.city}`}
                          disabled={!podeAlterar}
                          inputMode="decimal"
                          defaultValue={texto(c.minimum)}
                          onBlur={(e) => mudarCidade(i, "minimum", e.target.value)}
                          className={`${INPUT} w-28 py-1.5`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          aria-label={`Prazo de ${c.city}`}
                          disabled={!podeAlterar}
                          inputMode="numeric"
                          defaultValue={c.deadlineHours}
                          onBlur={(e) => mudarCidade(i, "deadlineHours", e.target.value)}
                          className={`${INPUT} w-20 py-1.5`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${c.city} só com veículo dedicado`}
                          disabled={!podeAlterar}
                          checked={c.dedicated}
                          onChange={(e) => mudarCidade(i, "dedicated", e.target.checked)}
                        />
                      </td>
                      {podeAlterar && (
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setCidades((atual) => atual.filter((_, j) => j !== i))} className="text-red-600 hover:underline">
                            Tirar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {podeAlterar && (
            <button
              onClick={() => void gravarCidades()}
              disabled={salvando}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2"
            >
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Gravar {cidades.length} cidade(s)
            </button>
          )}
        </div>
      )}

      <form onSubmit={simular} className={`${CARD} p-4 md:p-6 space-y-3 md:space-y-4`}>
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator className="w-5 h-5 text-blue-600" />
          Simular frete
        </h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-6">
          <label className={`${CAMPO} col-span-2`}>
            <span className={LABEL}>Cidade de destino</span>
            <input required value={sim.city} onChange={(e) => setSim({ ...sim, city: e.target.value })} className={INPUT} />
          </label>
          <label className={CAMPO}>
            <span className={LABEL}>Peso (kg)</span>
            <input required inputMode="decimal" value={sim.weight} onChange={(e) => setSim({ ...sim, weight: e.target.value })} className={INPUT} />
          </label>
          <label className={CAMPO}>
            <span className={LABEL}>Volumes</span>
            <input inputMode="numeric" value={sim.volumes} onChange={(e) => setSim({ ...sim, volumes: e.target.value })} className={INPUT} />
          </label>
          <label className={CAMPO}>
            <span className={LABEL}>Valor da nota (R$)</span>
            <input inputMode="decimal" value={sim.invoiceValue} onChange={(e) => setSim({ ...sim, invoiceValue: e.target.value })} className={INPUT} />
          </label>
          <label className={CAMPO}>
            <span className={LABEL}>Volume (m³)</span>
            <input inputMode="decimal" value={sim.cubicMeters} onChange={(e) => setSim({ ...sim, cubicMeters: e.target.value })} className={INPUT} />
          </label>
          <label className={`${CAMPO} col-span-2`}>
            <span className={LABEL}>Tabela</span>
            <select value={sim.tableId} onChange={(e) => setSim({ ...sim, tableId: e.target.value })} className={INPUT}>
              <option value="">A padrão em vigor</option>
              {tabelas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
          Calcular
        </button>

        {erroSim && (
          <p role="alert" className="text-sm text-red-600">
            {erroSim}
          </p>
        )}

        {resultado && (
          <div aria-live="polite" className="pt-4 border-t border-gray-100 dark:border-gray-800 text-sm">
            <p className="text-xs text-gray-500">Tabela: {resultado.tabela.name}</p>
            {!resultado.frete.atendida ? (
              <p className="mt-1 text-gray-700 dark:text-gray-300">Esta cidade não está na tabela.</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(resultado.frete.valor)}</p>
                <p className="text-gray-600 dark:text-gray-300">
                  {resultado.frete.cidade} · prazo de {resultado.frete.prazoHoras} horas
                </p>
                <ul className="mt-3 space-y-1 text-gray-600 dark:text-gray-300">
                  {resultado.frete.composicao.map((item) => (
                    <li key={item.rotulo} className="flex justify-between gap-4">
                      <span>{item.rotulo}</span>
                      <span>{formatCurrency(item.valor)}</span>
                    </li>
                  ))}
                </ul>
                {resultado.frete.avisos.map((aviso) => (
                  <p key={aviso} role="alert" className="mt-2 text-amber-700">
                    {aviso}
                  </p>
                ))}
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
