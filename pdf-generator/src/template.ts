import type { CompanyInfo, DeliveryTerms, FreightRules, PoloGroup, VehicleType } from "./data.js";

function deadlineBadge(deadline: string): string {
  const is48 = deadline.includes("48");
  const cls = is48 ? "badge badge-48" : "badge badge-24";
  return `<span class="${cls}">${deadline}</span>`;
}

function ruleCard(label: string, value: string, note: string): string {
  return `
    <div class="rule-card">
      <div class="rule-label">${label}</div>
      <div class="rule-value">${value}</div>
      <div class="rule-note">${note}</div>
    </div>`;
}

function fleetSection(vehicles: VehicleType[]): string {
  const cards = vehicles
    .map(
      (v) => `
      <div class="fleet-card">
        <div class="fleet-name">${v.name}</div>
        <div class="fleet-desc">${v.description}</div>
      </div>`
    )
    .join("");

  return `
    <div class="fleet-grid">${cards}</div>
    <p class="fleet-note">Frota variada distribuída pelos polos regionais — estamos sempre prontos para atender sua entrega, onde quer que ela precise chegar.</p>`;
}

function poloSection(group: PoloGroup): string {
  const rows = group.cities
    .map((c) => `<tr><td>${c.name}</td><td class="td-center">${deadlineBadge(c.deadline)}</td></tr>`)
    .join("");

  return `
    <section class="polo-section">
      <div class="polo-heading">
        <h3>${group.polo}</h3>
        <span class="polo-count">${group.cities.length} cidade${group.cities.length === 1 ? "" : "s"}</span>
      </div>
      <table class="city-table">
        <thead><tr><th>Cidade</th><th>Prazo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

export function buildHtml(
  company: CompanyInfo,
  rules: FreightRules,
  terms: DeliveryTerms,
  polos: PoloGroup[],
  vehicles: VehicleType[]
): string {
  const totalCities = polos.reduce((sum, p) => sum + p.cities.length, 0);
  const generatedAt = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Tarifas e Regras Gerais de Frete - ${company.legalName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --accent: #D97706;
    --accent-light: #FBBF24;
    --ink: #1F2328;
    --ink-soft: #5B6472;
    --line: #E4E4E7;
    --surface: #FAFAF9;
    --surface-2: #F4F1EA;
    --badge-24: #B45309;
    --badge-48: #9A3412;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Outfit', sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.45;
  }
  h1, h2, h3 { font-weight: 700; letter-spacing: -0.01em; }

  /* ---------- Cover / header band ---------- */
  .header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 14px;
    border-bottom: 3px solid var(--accent);
    margin-bottom: 16px;
  }
  .logo {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--accent-light), var(--accent));
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 800;
  }
  .header-text h1 { font-size: 17pt; color: #17181C; }
  .header-text p { font-size: 9pt; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

  .contact-bar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px 18px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 18px;
    font-size: 9pt;
  }
  .contact-bar div span.k { color: var(--ink-soft); display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; }
  .contact-bar div span.v { font-weight: 600; }

  .section-title {
    font-size: 12.5pt;
    color: #17181C;
    margin: 20px 0 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .section-title .bar { width: 4px; height: 12px; background: var(--accent); border-radius: 2px; display: inline-block; }

  /* ---------- Rule cards ---------- */
  .rule-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .rule-card {
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 9px 11px;
    background: #fff;
    break-inside: avoid;
  }
  .rule-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); }
  .rule-value { font-size: 13pt; font-weight: 700; color: var(--accent); margin: 2px 0; }
  .rule-note { font-size: 8.3pt; color: var(--ink-soft); }

  .note-box {
    margin-top: 10px;
    background: #FFF7ED;
    border: 1px solid #FDE1B8;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 8.6pt;
    color: #7C4A03;
  }

  /* ---------- Delivery terms ---------- */
  .terms-row { display: flex; gap: 12px; }
  .term-pill {
    flex: 1;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 9px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .term-pill .label { font-size: 9pt; font-weight: 600; }
  .badge {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 8pt;
    font-weight: 700;
    color: #fff;
  }
  .badge-24 { background: var(--badge-24); }
  .badge-48 { background: var(--badge-48); }

  /* ---------- Fleet ---------- */
  table { width: 100%; border-collapse: collapse; }
  .fleet-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .fleet-card {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--surface-2);
    break-inside: avoid;
  }
  .fleet-name { font-weight: 700; font-size: 9.5pt; color: #17181C; }
  .fleet-desc { font-size: 8.3pt; color: var(--ink-soft); margin-top: 2px; }
  .fleet-note { font-size: 8.6pt; color: var(--ink-soft); margin-top: 10px; }

  /* ---------- Cities appendix ---------- */
  .page-break { break-before: page; }
  .appendix-intro { font-size: 9pt; color: var(--ink-soft); margin-bottom: 14px; }
  .polo-grid {
    column-count: 2;
    column-gap: 18px;
  }
  .polo-section {
    break-inside: avoid;
    margin-bottom: 14px;
  }
  .polo-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 2px solid var(--accent-light);
    padding-bottom: 3px;
    margin-bottom: 4px;
  }
  .polo-heading h3 { font-size: 10pt; }
  .polo-count { font-size: 7.6pt; color: var(--ink-soft); }
  .city-table th, .city-table td {
    padding: 3px 4px;
    font-size: 8.2pt;
    border-bottom: 1px solid var(--line);
  }
  .city-table th { text-align: left; color: var(--ink-soft); font-weight: 600; font-size: 7.2pt; text-transform: uppercase; }
  .td-center { text-align: right; }
  .city-table .badge { font-size: 6.6pt; padding: 1px 6px; }
</style>
</head>
<body>

  <div class="header">
    <div class="logo">M</div>
    <div class="header-text">
      <h1>${company.legalName}</h1>
      <p>Tabela de Tarifas e Regras Gerais de Frete</p>
    </div>
  </div>

  <div class="contact-bar">
    <div><span class="k">Telefone Comercial</span><span class="v">${company.phone}</span></div>
    <div><span class="k">WhatsApp Comercial</span><span class="v">${company.whatsapp}</span></div>
    <div><span class="k">E-mail Comercial</span><span class="v">${company.email}</span></div>
    <div><span class="k">Website Oficial</span><span class="v">${company.website}</span></div>
    <div><span class="k">Área de Cobertura</span><span class="v">${company.coverage}</span></div>
    <div><span class="k">Endereço Sede</span><span class="v">${company.address}</span></div>
  </div>

  <div class="section-title"><span class="bar"></span>Regras Gerais de Frete</div>
  <div class="rule-grid">
    ${ruleCard("Frete Mínimo", rules.minFreight, rules.minFreightRule)}
    ${ruleCard("Frete Peso", rules.weightRate, rules.weightRateRule)}
    ${ruleCard("Fator de Cubagem", rules.cubageFactor, rules.cubageFormula)}
    ${ruleCard("Limite de Valor de NF", rules.nfLimit, "Acima disso, consultar o comercial")}
    ${ruleCard("Reentrega", rules.redelivery, "Nova tentativa de entrega")}
    ${ruleCard("Devolução / Retorno", rules.returnFee, "Recusa da mercadoria")}
  </div>
  <div class="note-box">${rules.note}</div>

  <div class="section-title"><span class="bar"></span>Prazos Padrão de Entrega</div>
  <div class="terms-row">
    <div class="term-pill"><span class="label">Geral</span>${deadlineBadge(terms.general)}</div>
    <div class="term-pill"><span class="label">Exceções (marcadas na tabela)</span>${deadlineBadge(terms.exceptions)}</div>
  </div>

  <div class="section-title"><span class="bar"></span>Nossa Frota</div>
  ${fleetSection(vehicles)}

  <div class="page-break"></div>
  <div class="section-title"><span class="bar"></span>Cidades Atendidas por Polo Regional</div>
  <p class="appendix-intro">Total de cidades atendidas: <strong>${totalCities}</strong> — UF: SP. Documento gerado em ${generatedAt}.</p>
  <div class="polo-grid">
    ${polos.map(poloSection).join("")}
  </div>

</body>
</html>`;
}
