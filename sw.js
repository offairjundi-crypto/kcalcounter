// 칼로리 추적기 서비스워커
// 전략: 네트워크 우선(재배포하면 항상 새 버전), 실패 시 캐시(오프라인에서도 화면은 뜸)
// 데이터에는 절대 손대지 않음: POST 요청·/api/·외부 도메인(Supabase 등)은 그대로 통과

const CACHE = "cal-tracker-v1";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                        // POST 등은 통과 (/api/analyze 포함)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // Supabase·CDN 등 외부는 통과
  if (url.pathname.startsWith("/api/")) return;            // API는 캐시하지 않음

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => r || caches.match("/"))
      )
  );
});
