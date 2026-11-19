// マッスルラボ Service Worker
// 方針: 同じフォルダのファイルは「キャッシュを即返し、裏で新版を取りに行く」。
//       次に開いたとき新版になるので、本体を更新してもキャッシュ名を上げなくてよい。
//       外部との通信はしない（このアプリは同じフォルダのファイルしか読まない）。
const CACHE="musclelab-v3";
const ASSETS=["./","./index.html","./manifest.json","./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    // ?debug=1 のような付け足しは無視して、同じファイルとして保存・取り出しする
    const key=url.origin+url.pathname;
    const cached=await c.match(key);
    const net=fetch(e.request).then(res=>{ if(res&&res.ok) c.put(key,res.clone()); return res; }).catch(()=>null);
    if(cached){ e.waitUntil(net); return cached; }
    const res=await net; if(res) return res;
    // つながらないとき: ページを開く要求にだけ本体を返す（それ以外は失敗として返す）
    if(e.request.mode==="navigate") return (await c.match("./index.html"))||Response.error();
    return Response.error();
  }));
});
