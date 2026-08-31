import Script from "next/script";

/**
 * Google Tag Manager — container GTM-TWJR2PM5, criado pelo TagFlow.
 *
 * O container já publica a configuração do GA4 (G-PXSGBEZ9TJ). Meta Pixel,
 * conversões de Ads e eventos novos entram por lá, sem novo deploy do site.
 *
 * O ID vem embutido como padrão de propósito: ele é público — vai no HTML de
 * qualquer jeito — e quando o valor mora só num `.env` fora do versionamento
 * ele se perde em migração de pasta ou build feito em outra máquina, e o site
 * fica sem medição sem ninguém notar. `NEXT_PUBLIC_GTM_ID` continua
 * sobrepondo, para builds de staging.
 */
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? "GTM-TWJR2PM5";

export function GoogleTagManagerScript() {
  if (!GTM_ID) return null;

  return (
    <Script id="gtm" strategy="afterInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
    </Script>
  );
}

/** Fallback do GTM para navegação sem JavaScript. Vai logo após `<body>`. */
export function GoogleTagManagerNoScript() {
  if (!GTM_ID) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
