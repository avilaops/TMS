"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import { findServiceArea, suggestServiceAreas } from "@/data/serviceAreas";
import { routeSlug } from "@/data/publicCatalog";
import { whatsappUrl } from "@/lib/whatsapp";

export function CityLookup() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const result = findServiceArea(query);
  return <div className="ui-city-lookup">
    <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
      <label htmlFor={id}>Qual é a cidade de destino?</label>
      <div className="ui-search-field"><Search size={20} aria-hidden="true" /><input id={id} value={query} onChange={(event) => { setQuery(event.target.value); setSubmitted(false); }} list={`${id}-options`} placeholder="Ex.: Mirassol" autoComplete="off" required /><button type="submit" aria-label="Consultar cidade"><ArrowUpRight size={22} /></button></div>
      <datalist id={`${id}-options`}>{suggestServiceAreas(query).map((area) => <option key={area.city} value={area.city} />)}</datalist>
    </form>
    <div aria-live="polite">
      {result ? <div className="ui-city-result"><strong>{result.city} é atendida</strong><p>Prazo previsto: {result.deadline.toLowerCase()}. Confirme a programação com a equipe.</p><Link href={`/cidades/${routeSlug(result.hub)}`}>Ver cidades e detalhes deste polo <ArrowUpRight size={16} /></Link><a href={whatsappUrl(`Olá! Gostaria de confirmar uma coleta para ${result.city}.`)} target="_blank" rel="noopener noreferrer">Confirmar pelo WhatsApp</a></div> : submitted && <div className="ui-city-result"><strong>Vamos confirmar essa cidade?</strong><p>A cidade informada não está na relação pública.</p><a href={whatsappUrl(`Olá! Vocês atendem a cidade de ${query.trim()}?`)} target="_blank" rel="noopener noreferrer">Consultar a equipe <ArrowUpRight size={16} /></a></div>}
    </div>
  </div>;
}
