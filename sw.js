const CACHE='passbook-ledger-v3.0.10';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./jsQR.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('passbook-ledger-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={title:'存摺記帳',body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'存摺記帳',{body:d.body||'',tag:d.tag||undefined,icon:'./icon-192.png',badge:'./icon-192.png',data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'./';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus()}return self.clients.openWindow(u)}))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.hostname==='open.er-api.com')return;
  if(req.mode==='navigate'){
    // 網路優先，但 2.5 秒沒回應就先用快取（訊號差時不用乾等）；網路回來後仍在背景更新快取
    const net=fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp))}return r});
    e.respondWith(new Promise(res=>{let done=false;const go=r=>{if(!done&&r){done=true;res(r)}};
      const t=setTimeout(()=>caches.match('./index.html').then(go),2500);
      net.then(r=>{clearTimeout(t);go(r)}).catch(()=>{clearTimeout(t);caches.match('./index.html').then(h=>go(h||Response.error()))})}));return;
  }
  if(url.hostname.endsWith('fonts.googleapis.com')||url.hostname.endsWith('fonts.gstatic.com')||url.hostname==='cdn.jsdelivr.net'||(url.hostname==='www.gstatic.com'&&url.pathname.startsWith('/firebasejs/'))){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(req);const net=fetch(req).then(r=>{c.put(req,r.clone());return r}).catch(()=>hit);return hit||net}));return;
  }
  if(url.origin===location.origin){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));return r})));
  }
});
