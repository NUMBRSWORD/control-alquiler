// Service worker de Mi Alquiler. Hace dos cosas:
//  1. Guarda una copia de la app para que abra rápido y funcione con mala
//     señal (los datos siempre vienen de Supabase en línea; nunca se guardan aquí).
//  2. Muestra los avisos de cobro que llegan por Web Push.
const CACHE = "mi-alquiler-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./lib/calc.js",
  "./lib/demo.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];
// Librerías y letra que la app carga de afuera: también se guardan para abrir sin señal.
const CDN = ["esm.sh", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero; si no hay señal, la copia guardada.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !CDN.includes(url.hostname)) return; // deja pasar Supabase
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok || resp.type === "opaque") {
          const copia = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() =>
        caches.match(event.request).then((c) => c || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      )
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Mi Alquiler", {
      body: data.body || "Tienes un cobro pendiente.",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: data.tag || "cobro",
      renotify: true,
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      const abierto = clientes.find((c) => c.url.startsWith(self.registration.scope));
      return abierto ? abierto.focus() : self.clients.openWindow(destino);
    })
  );
});
