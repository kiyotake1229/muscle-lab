// マッスルラボ Service Worker
//
// 何をするか
// - 同じフォルダのファイルは「保存してある版をすぐ返し、裏で新しい版を取りに行く」。
//   次に開いたとき新しい版になるので、本体（index.html）を更新しても下の CACHE の番号を上げなくてよい。
//   先に保存するファイルの一覧（ASSETS）を変えたときだけ上げる
// - 外部との通信はしない（このアプリは同じフォルダのファイルしか読まない）
// - github.io は同じドメインにほかのアプリも載り、キャッシュの置き場所はドメインに1つしかない。
//   古い版を消すときは、名前が「musclelab-」で始まるものだけを消す（ほかのアプリのキャッシュには触らない）
// - 逆に、同じドメインのほかのアプリの中には、自分以外のキャッシュを全部消すものがある。
//   消されても戻るよう、ページを開くたびに（つながっているとき）、先に保存するファイルのうち
//   無くなったものだけを取り直す（refill）。消された直後に通信なしで開いた場合は防げないが、
//   一度つながった状態で開けば元に戻る
//
// 登録は index.html の最後の小さなスクリプトが行う（ファイルを直接開いたとき・iframe の中では登録しない）。
const PREFIX="musclelab-";
const CACHE=PREFIX+"v4";
const ASSETS=["./","./index.html","./manifest.json","./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];

self.addEventListener("install",e=>{
  // HTTP のキャッシュを通さずに取る（版を上げたとき、古いファイルを入れないため）
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

// 先に保存するファイルのうち、キャッシュに無いものだけを取り直す
async function refill(){
  const c=await caches.open(CACHE);
  await Promise.all(ASSETS.map(async u=>{
    if(await c.match(u)) return;
    try{
      const res=await fetch(new Request(u,{cache:"reload"}));
      if(res.ok&&res.type==="basic"&&!res.redirected) await c.put(u,res);
    }catch(err){ /* 取れなければ、次に開いたときにまた試す */ }
  }));
}

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  // ほかのサイトのもの・このアプリの外（同じドメインの別のアプリ）は触らない
  if(url.origin!==location.origin) return;
  if(!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const nav=e.request.mode==="navigate";
  e.respondWith(caches.open(CACHE).then(async c=>{
    // ?debug=1 のような付け足しは無視して、同じファイルとして保存・取り出しする
    const key=url.origin+url.pathname;
    const cached=await c.match(key);
    const net=fetch(e.request).then(res=>{
      if(res&&res.ok&&res.type==="basic"&&!res.redirected) c.put(key,res.clone()).catch(()=>{});
      return res;
    }).catch(()=>null);
    // ページを開いたとき、つながっていれば欠けたファイルを入れ直す（表示は待たせない）
    if(nav) e.waitUntil(net.then(res=>res?refill():null).catch(()=>{}));
    if(cached){ e.waitUntil(net); return cached; }
    const res=await net;
    if(res) return res;
    // つながらないとき: ページを開く要求にだけ本体を返す（それ以外は失敗として返す）
    if(nav) return (await c.match("./index.html"))||Response.error();
    return Response.error();
  }));
});
