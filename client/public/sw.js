const CACHE_NAME = "araldo";
const STATIC_ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  //web share target
  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();

        const title = formData.get("title") || "";
        const text  = formData.get("text")  || "";
        const shareUrl = formData.get("url") || "";
        const files = formData.getAll("files").filter((f) => f instanceof File);
        // presist payload in cache storage so the client page can read it
        const sharePayload = {
          title,
          text,
          url: shareUrl,
          files: await Promise.all(
            files.map(async (file) => {
              const ab = await file.arrayBuffer();
              const bytes = new Uint8Array(ab);
              let binary = "";
              bytes.forEach((b) => (binary += String.fromCharCode(b)));
              return {
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size,
                data: btoa(binary),
              };
            })
          ),
          receivedAt: Date.now(),
        };
        const cache = await caches.open("share-target-v1");
        await cache.put(
          "/share-payload",
          new Response(JSON.stringify(sharePayload), {
            headers: { "Content-Type": "application/json" },
          })
        );

        // redirect
        return Response.redirect("/#/share-receive", 303);
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((r) => r ?? new Response("offline", { status: 503 }))
      )
  );
});
