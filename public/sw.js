/**
 * Service worker do app do motorista (Mello Motorista).
 *
 * Escopo de atuação: só intercepta requisições de /driver e dos assets que o
 * app precisa. Qualquer outra rota do site passa direto, sem cache — o site
 * institucional e o dashboard continuam se comportando como antes.
 *
 * Estratégia:
 *  - navegação (HTML): rede primeiro, cache como reserva quando estiver offline;
 *  - assets do Next (/_next/static): cache primeiro, pois têm hash no nome;
 *  - POST e demais métodos: nunca passam por aqui. A fila offline da baixa de
 *    entrega vive na página, em IndexedDB (src/lib/offline-queue.ts), porque
 *    precisa avisar o motorista do que ficou pendente.
 */

const VERSION = "mello-driver-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = "/driver/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
      // Se a página de offline não puder ser baixada agora, seguimos mesmo
      // assim: o SW ainda serve para o cache de navegação.
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isDriverNavigation(request, url) {
  return (
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/driver")
  );
}

function isNextAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navegação dentro do app do motorista: rede primeiro.
  if (isDriverNavigation(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response("Sem conexão.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }

  // Bundles do Next têm hash no nome, então cache primeiro é seguro.
  if (isNextAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
