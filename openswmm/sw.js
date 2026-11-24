importScripts("./vendor/offline-version.js");
const prefix = "openswmm:" + self.registration.scope + ":";
const cacheName = prefix + self.workbenchVersion;
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("./offline-files.json", { cache: "reload" });
      if (!response.ok) throw new Error("Missing offline asset list");
      const manifest = await response.json();
      if (manifest.version !== self.workbenchVersion)
        throw new Error("App update in progress");
      const cache = await caches.open(cacheName);
      await cache.addAll(
        manifest.files.map(
          (path) =>
            new Request(new URL(path, self.registration.scope), {
              cache: "reload",
            }),
        ),
      );
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(prefix) && key !== cacheName)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
// Cross-origin isolation on a static host: GitHub Pages cannot send COOP/COEP, so the
// worker adds them to every same-origin response. With them the page may use
// SharedArrayBuffer, which the multi-threaded engine build needs. Cross-origin
// requests keep going to the network untouched; everything the app loads from other
// origins is fetched with CORS, as COEP require-corp demands.
function isolated(response) {
  if (!response || response.type === "opaque" || response.type === "error") return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (
    request.method !== "GET" ||
    !request.url.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const key =
        request.mode === "navigate"
          ? new URL("index.html", self.registration.scope).href
          : request;
      return isolated((await cache.match(key)) || (await fetch(request)));
    })(),
  );
});
