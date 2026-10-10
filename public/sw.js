/**
 * Service worker do TMS: o modo offline do app do motorista (Mello Motorista)
 * e as notificações push de todas as áreas.
 *
 * Um arquivo, três registros possíveis, cada um com o seu escopo:
 *  - "/" — o do app do motorista (src/components/driver/DriverShell.tsx). É o
 *    único que intercepta requisições e guarda páginas;
 *  - "/dashboard" e "/portal" — criados só quando a pessoa ativa as
 *    notificações no sininho (src/lib/push-cliente.ts). Recebem push e mais
 *    nada: não têm ouvinte de `fetch`, não guardam página nem arquivo.
 *
 * Offline (só no registro da raiz): intercepta as requisições de /driver e dos
 * assets que o app precisa. Qualquer outra rota do site passa direto, sem
 * cache — o site institucional e o dashboard continuam se comportando como antes.
 *
 * Estratégia:
 *  - navegação (HTML): rede primeiro, cache como reserva quando estiver offline;
 *  - assets do Next (/_next/static): cache primeiro, pois têm hash no nome;
 *  - POST e demais métodos: nunca passam por aqui. A fila offline da baixa de
 *    entrega vive na página, em IndexedDB (src/lib/offline-queue.ts), porque
 *    precisa avisar o motorista do que ficou pendente.
 *
 * Push: o servidor manda `{ id, titulo, texto, url }`
 * (src/lib/notificacoes-push.ts). O toque na notificação foca a aba que já
 * está nesse endereço ou abre uma.
 */

const VERSION = "mello-driver-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = "/driver/offline";

// Só o registro da raiz (o do app do motorista) cuida do offline.
const ESCOPO = new URL(self.registration.scope).pathname;
const ATENDE_OFFLINE = ESCOPO === "/";

self.addEventListener("install", (event) => {
  if (!ATENDE_OFFLINE) {
    event.waitUntil(self.skipWaiting());
    return;
  }
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
  if (!ATENDE_OFFLINE) {
    // Os caches são do registro da raiz: este não mexe neles.
    event.waitUntil(self.clients.claim());
    return;
  }
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

function atenderOffline(event) {
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
}

// Os registros de /dashboard e /portal ficam sem ouvinte de `fetch`: nada do
// painel nem do portal passa pelo service worker.
if (ATENDE_OFFLINE) self.addEventListener("fetch", atenderOffline);

/* ---------------------------------- Push ---------------------------------- */

const TITULO_PADRAO = "Novo aviso";
const ICONE = "/web-app-manifest-192x192.png";
const SELO = "/favicon-96x96.png";

// A área deste registro: é para onde vai o toque num aviso sem endereço válido.
const INICIO = ATENDE_OFFLINE ? "/driver" : ESCOPO;

/** Só caminho interno do sistema (uma barra só no começo); o resto cai no início da área. */
function caminhoInterno(url) {
  return typeof url === "string" && /^\/(?!\/)/.test(url) && !url.includes("\\") ? url : INICIO;
}

self.addEventListener("push", (event) => {
  let aviso = {};
  try {
    aviso = (event.data && event.data.json()) || {};
  } catch {
    aviso = {};
  }

  const titulo = typeof aviso.titulo === "string" && aviso.titulo ? aviso.titulo : TITULO_PADRAO;
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: typeof aviso.texto === "string" ? aviso.texto : "",
      icon: ICONE,
      badge: SELO,
      // O mesmo aviso entregue duas vezes não vira duas notificações.
      tag: typeof aviso.id === "string" ? aviso.id : undefined,
      data: { id: typeof aviso.id === "string" ? aviso.id : null, url: caminhoInterno(aviso.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const dados = event.notification.data || {};
  const destino = new URL(caminhoInterno(dados.url), self.location.origin).href;

  // Quem tocou na notificação já leu o aviso: some do contador do sininho. Se
  // a marcação falhar (sem rede, sessão vencida), o aviso só continua como não lido.
  const marcar = dados.id
    ? fetch("/api/notificacoes/lidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids: [dados.id] }),
      }).catch(() => undefined)
    : Promise.resolve();

  const abrir = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abas) => {
    const aberta = abas.find((aba) => aba.url === destino);
    return aberta ? aberta.focus() : self.clients.openWindow(destino);
  });

  event.waitUntil(Promise.all([abrir, marcar]));
});
