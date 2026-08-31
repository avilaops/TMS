"use client";

import { useEffect } from "react";
import { pushDataLayer } from "@/lib/analytics";

function getContactChannel(href: string) {
  if (/wa\.me|whatsapp\.com/i.test(href)) return "whatsapp";
  if (/^tel:/i.test(href)) return "telefone";
  if (/^mailto:/i.test(href)) return "email";
  if (/instagram\.com/i.test(href)) return "instagram";
  if (/google\.[^/]+\/maps|maps\.app\.goo\.gl/i.test(href)) return "maps";
  return null;
}

/**
 * O que a pessoa estava pedindo quando clicou. Vira `lead_subject` no GA4 e é
 * o que separa "20 leads" de "14 de coleta e 6 de rastreio" — a diferença
 * entre um número e uma decisão de campanha.
 */
function getLeadSubject(anchor: HTMLAnchorElement) {
  const marcado = anchor.closest<HTMLElement>("[data-lead-subject]");
  if (marcado?.dataset.leadSubject) return marcado.dataset.leadSubject;

  const texto = anchor.textContent?.trim().replace(/\s+/g, " ");
  if (texto) return texto.slice(0, 80);

  return window.location.pathname;
}

/**
 * Marca como lead todo clique que tira a pessoa do site em direção a um canal
 * de atendimento.
 *
 * A cotação fechada acontece por telefone ou WhatsApp, fora de qualquer
 * medição. O clique de saída é o último sinal observável, e por isso é ele —
 * junto com o envio do formulário de cotação — que faz o papel de conversão no
 * GA4.
 *
 * O listener é delegado no `document` de propósito. Instrumentar botão a botão
 * significa que todo CTA novo nasce sem medição até alguém lembrar — e ninguém
 * lembra. Aqui um link novo para o WhatsApp já entra medido.
 */
export default function AnalyticsClickTracker() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!anchor) return;

      const channel = getContactChannel(anchor.href);
      if (!channel) return;

      pushDataLayer({
        event: "generate_lead",
        lead_source: channel,
        lead_subject: getLeadSubject(anchor),
        link_url: anchor.href,
        page_path: window.location.pathname,
      });
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
