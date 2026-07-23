import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer";
import { companyInfo, freightRules, deliveryTerms, loadCities, groupByPolo, getFleetTypes } from "./data.js";
import { buildHtml } from "./template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../output");
const OUTPUT_FILE = join(OUTPUT_DIR, "Mello-Transportes-Regras-de-Frete.pdf");

async function main() {
  const cities = loadCities();
  const polos = groupByPolo(cities);
  const vehicles = getFleetTypes(cities);
  const html = buildHtml(companyInfo, freightRules, deliveryTerms, polos, vehicles);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "14mm", left: "14mm", right: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%; font-size:7.5pt; font-family:'Outfit',sans-serif; color:#9CA3AF; padding:0 14mm; display:flex; justify-content:space-between;">
          <span>Mello Transportes Rio Preto — Tarifas e Regras Gerais de Frete</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });

    writeFileSync(OUTPUT_FILE, pdf);
    console.log(`PDF gerado em: ${OUTPUT_FILE}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
