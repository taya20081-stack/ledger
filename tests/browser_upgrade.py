from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import tempfile
from threading import Thread
from playwright.sync_api import sync_playwright

root = Path.cwd()
with tempfile.TemporaryDirectory() as target:
    path = Path(target)
    for name in ('manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'jsQR.js'):
        shutil.copyfile(root / name, path / name)
    for name in ('index.html', 'sw.js'):
        (path / name).write_bytes(subprocess.check_output(['git', 'show', f'854d1cba:{name}']))

    class Quiet(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'")
            super().end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=target))
    Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            ctx = browser.new_context()
            ctx.add_init_script('window.__ARTIFACT__=true')
            page = ctx.new_page()
            page.goto(url)
            page.wait_for_function("window.APP_VER==='v2.0.83'&&S.ready&&navigator.serviceWorker.controller")
            page.wait_for_timeout(600)
            page.wait_for_function("window.APP_VER==='v2.0.83'&&S.ready")
            page.evaluate("""async()=>{
                await DB.putRecs([{id:'mock-local',dt:'2026-01-10',n:'測試資料',m:10}]);
                await caches.open('other-app-test');
            }""")
            for name in ('index.html', 'sw.js'):
                shutil.copyfile(root / name, path / name)
            try:
                page.evaluate('async()=>(await navigator.serviceWorker.ready).update()')
            except Exception as e:
                if 'execution context was destroyed' not in str(e).lower():
                    raise
            page.wait_for_function("window.APP_VER==='v2.0.84'&&S.ready", timeout=30000)
            result = page.evaluate("""async()=>{
                const original=DB.putRecs;
                DB.putRecs=function(rows){
                  return this.run(['rec'],t=>{t.objectStore('rec').put(rows[0]);t.abort()});
                };
                let rejected;
                try{await mutate([{...S.byId.get('mock-local'),m:99}])}
                catch(e){rejected=e instanceof LocalWriteError}
                DB.putRecs=original;
                return {
                    rejected,
                    stored:(await DB.load()).recs.find(r=>r.id==='mock-local')?.m,
                    memory:S.byId.get('mock-local')?.m,
                    caches:await caches.keys()
                };
            }""")
            assert result['rejected'] and result['stored']==result['memory']==10, result
            assert 'passbook-ledger-v2.0.84' in result['caches'], result
            assert 'passbook-ledger-v2.0.83' not in result['caches'], result
            assert 'other-app-test' in result['caches'], result
            browser.close()
            print('Chromium：v2.0.83 → v2.0.84 快取切換，保留 IndexedDB 與其他 Cache，真實寫入中止測試通過')
    finally:
        server.shutdown()
