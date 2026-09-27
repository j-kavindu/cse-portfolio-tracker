/*
 * service-worker.js
 * Deliberately simple: precache the app shell, then use a network-first
 * strategy for same-origin requests (falling back to cache when offline)
 * so that during development a hard refresh always sees your latest code
 * rather than a stale cached version. Only uses relative paths so this
 * works correctly under a GitHub Pages project subpath
 * (https://USERNAME.github.io/REPOSITORY/).
 */
const CACHE_NAME = "cse-tracker-v6";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/main.css?v=4",
  "./js/config.js",
  "./js/auth.js",
  "./js/cloud.js",
  "./js/pwa.js",
  "./js/calculator.js",
  "./js/db.js",
  "./js/charts.js",
  "./js/demo.js",
  "./js/app.js",
  "./manifest.json",
  "./assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
