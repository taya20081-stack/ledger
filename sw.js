const CACHE='passbook-ledger-v1.9.12';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./jsQR.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.hostname==='open.er-api.com')return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));return r}).catch(()=>caches.match('./index.html')));return;
  }
  if(url.hostname.endsWith('fonts.googleapis.com')||url.hostname.endsWith('fonts.gstatic.com')||url.hostname==='cdn.jsdelivr.net'||(url.hostname==='www.gstatic.com'&&url.pathname.startsWith('/firebasejs/'))){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(req);const net=fetch(req).then(r=>{c.put(req,r.clone());return r}).catch(()=>hit);return hit||net}));return;
  }
  if(url.origin===location.origin){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));return r})));
  }
});
