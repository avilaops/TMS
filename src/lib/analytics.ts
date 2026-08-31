/**
 * Camada fina sobre o dataLayer do GTM.
 *
 * Tudo aqui empurra evento para o dataLayer e para. Nenhuma tag do Google ou da
 * Meta é escrita no código do site: quem traduz esses eventos em GA4, Pixel ou
 * conversão de Ads é o container GTM-TWJR2PM5, configurado pelo TagFlow. É isso
 * que permite ligar um pixel novo sem deploy.
 *
 * Se o GTM não estiver carregado, o push cai num array que ninguém lê — sem
 * erro e sem efeito.
 */

type DataLayerWindow = Window & {
  dataLayer?: Array<Record<string, unknown>>;
};

export function pushDataLayer(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const target = window as DataLayerWindow;
  target.dataLayer = target.dataLayer || [];
  target.dataLayer.push(payload);
}
