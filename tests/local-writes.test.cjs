const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
function section(start, end) {
  const offset = html.indexOf(start);
  const stop = html.indexOf(end, offset);
  assert.ok(offset >= 0 && stop > offset);
  return html.slice(offset, stop);
}

function fixture(storage = {kv: new Map()}) {
  const rec = new Map();
  const S = {recs: [], byId: new Map(), settings: {}, kvu: {}, rules: [],
    accts: [{id: 'cash', name: '現金'}], tpls: [],
    cats: {exp: [{n:'生活',subs:['舊分類']}], inc: []}};
  const D = {live: [], acct: new Map(S.accts.map(a => [a.id, a]))};
  const Cloud = {user: {uid: 'example-user'}, decided: true,
    writes: [], canSync: true, pushRecs(rows) {this.writes.push(...rows)},
    pushKV(key, value, stamp) {this.writes.push({key, value, stamp})},
    async waitForInboxSync() {return this.canSync}};
  const DB = {
    mem: false, failRec: false, failKV: false,
    async putRecs(rows) {
      if(this.failRec)throw new Error('mock record abort');
      for(const row of rows)rec.set(row.id, structuredClone(row));
    },
    async getKV(key) {return storage.kv.get(key)},
    async putKV(key, value) {
      if(this.failKV)throw new Error('mock KV abort');
      storage.kv.set(key, structuredClone(value));
    },
    async run(stores, callback) {
      const writes = new Map(storage.kv), requests = [];
      const store = {
        get(key) {const request = {result: writes.get(key)};requests.push(request);return request},
        put(value, key) {writes.set(key, structuredClone(value))}
      };
      callback({objectStore: () => store});
      requests.forEach(r => r.onsuccess());
      if(this.failKV)throw new Error('mock KV abort');
      storage.kv = writes;
    }
  };
  const context = vm.createContext({
    DB, S, D, Cloud, crypto: require('node:crypto').webcrypto, firebase: {firestore:{FieldValue:{serverTimestamp:()=>0}}}, GOLD_U: {}, window: {Cloud, addEventListener() {}}, structuredClone, setTimeout, clearTimeout,
    toast() {}, ensureCats() {}, recompute() {D.live = S.recs.filter(r => !r.x)}, scheduleRender() {},
    async fixOsGroups() {}, r2: n => n, fmt: String, TODAY: () => '2026-01-01', NOWTM: () => '12:00',
    balAt: () => D.live.reduce((sum,r) => sum + r.m, 0),
    addMonths(date, months) {return '2026-' + String(1 + months).padStart(2, '0') + '-01'}
  });
  vm.runInContext([
    section('class LocalWriteError', 'function rateOf'),
    section('let recordWrites', '/* ================= recurring'),
    section('async function renProj(', 'function ruleName('),
    section('async function renameSub(', '/* ================= record building'),
    section('const INBOX_SOURCES=', 'function inboxSharedStatus()'),
    'let inboxBusy=Promise.resolve();',
    section('const inboxAwaitingCloud=', 'function processInbox(docs)'),
    section('function processInbox(docs)', "ACT['copy-uid']")
  ].join('\n'), context);
  return {context, S, Cloud, DB, rec, get kv() {return storage.kv},
    run(code) {return vm.runInContext(code, context)}};
}

function command(data) {
  let current={...data};
  const doc = {id:'example-command', data:()=>current};
  doc.ref = {id:doc.id, path:'users/example-user/inbox/'+doc.id, deletes:0, fail:false, async delete(){
    this.deletes++;
    if(this.fail)throw new Error('mock Firestore delete failure');
    current=null;
  }};
  let tail=Promise.resolve();
  doc.db={denied:false,runTransaction(callback){
    const result=tail.then(async()=>{
      if(this.denied)throw Object.assign(new Error('permission denied'),{code:'permission-denied'});
      const writes=[];
      const value=await callback({
        get:async()=>({id:doc.id,ref:doc.ref,exists:!!current,data:()=>current}),
        update:(_,patch)=>writes.push(patch),
      });
      for(const patch of writes)current={...current,...patch};
      return value;
    });
    tail=result.catch(()=>{});
    return result;
  }};
  return doc;
}
async function process(f, doc) {
  f.Cloud.db=doc.db;
  f.context.doc = doc;
  await f.run('processInbox([doc]); inboxBusy');
}

test('記錄交易中止時保留原狀並回傳失敗', async () => {
  const f = fixture();
  await f.run("mutate([{id:'r1',m:10,dt:'2026-01-01'}])");
  f.DB.failRec = true;
  await assert.rejects(f.run("mutate([{id:'r1',m:20,dt:'2026-01-01'}])"), {message: '記錄未能寫入此裝置'});
  await assert.rejects(f.run("mutate([] ,['r1'])"));
  assert.equal(f.S.byId.get('r1').m, 10);
  assert.equal(f.rec.get('r1').m, 10);
  assert.equal(f.Cloud.writes.length, 1);
});

test('跨月修改依序排入舊月刪除標記與新月記錄', async () => {
  const f = fixture();
  await f.run("mutate([{id:'r1',dt:'2026-01-01'}])");
  await f.run("mutate([{id:'r1',dt:'2026-02-01'}])");
  const [tombstone, saved] = f.Cloud.writes.slice(1);
  assert.equal(tombstone.dt, '2026-01-01');
  assert.equal(tombstone.x, 1);
  assert.equal(saved.dt, '2026-02-01');
  assert.ok(saved.u > tombstone.u);
});

test('設定與版本一起提交，失敗時不排入雲端', async () => {
  const f = fixture();
  f.DB.failKV = true;
  await assert.rejects(f.run("S.settings.gold={q:3}; saveKV('settings')"));
  assert.equal(f.kv.size, 0);
  assert.equal(f.S.kvu.settings, undefined);
  assert.equal(f.Cloud.writes.length, 0);
  f.DB.failKV = false;
  await f.run("saveKV('settings')");
  assert.equal(f.kv.get('settings').gold.q, 3);
  assert.equal(f.kv.get('kvu').settings, f.Cloud.writes[0].stamp);
});

test('分期記錄完成但規則寫入中止，其他裝置保留原指令', async () => {
  const f = fixture();
  const doc = command({kind: 'inst', n: '測試分期', a: 'cash', cnt: 4, sno: 2, amt: 10, dt: '2026-01-01'});
  f.DB.failKV = true;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(f.S.rules.length, 0);
  assert.deepEqual([...f.rec.keys()], ['ib_example-command_i2','ib_example-command_i3','ib_example-command_i4']);
  const reopened=fixture();
  await process(reopened, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(doc.data()._ledgerInbox.state,'review');
  assert.equal(reopened.Cloud.writes.length,0);
  assert.equal(f.Cloud.writes.filter(row => row.id).length, 3);
});

test('同步未確認或刪除失敗時，重送不重跑已寫入的同分頁操作', async () => {
  const f = fixture();
  const doc = command({kind: 'gold', q: 2});
  f.Cloud.canSync = false;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(f.Cloud.writes.length, 1);
  f.Cloud.canSync = true;
  doc.ref.fail = true;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 1);
  doc.ref.fail = false;
  f.context.doc = doc;
  await f.run('processInbox([doc]); processInbox([doc]); inboxBusy');
  assert.equal(doc.ref.deletes, 2);
  assert.equal(f.Cloud.writes.length, 1);
});

test('刪除失敗後重開分頁可以查到已確認的完成憑證', async () => {
  const first = fixture();
  const doc = command({kind:'gold',q:5});
  doc.ref.fail = true;
  await process(first, doc);
  const second = fixture();
  assert.equal(doc.data()._ledgerInbox.state,'completed');
  doc.ref.fail = false;
  await process(second, doc);
  assert.equal(doc.ref.deletes, 2);
  assert.equal(second.Cloud.writes.length, 0);
});

test('無效 JSON 與找不到目標的編輯指令會保留', async () => {
  const f = fixture();
  f.context.D = {live: [], acct: new Map()};
  for(const data of [{kind:'px',p:'{'}, {kind:'edit',n:'不存在',dt:'2026-01-01'}]) {
    const doc = command(data);
    await process(f, doc);
    assert.equal(doc.ref.deletes, 0);
    assert.equal(doc.data()._ledgerInbox.state,'invalid');
  }
});

test('edit、del、bal、rensub、renproj、mvproj 重送時不重複寫入', async () => {
  for (const [data, expected] of [
    [{kind:'edit', dt:'2026-01-01', n:'測試記錄', nn:'已改名'}, row => row.n === '已改名'],
    [{kind:'del', dt:'2026-01-01', n:'測試記錄'}, row => row.x === 1],
    [{kind:'bal', dt:'2026-01-01', a:'cash', amt:100}, (_, f) => f.rec.get('ib_example-command')?.m === 90],
    [{kind:'rensub', k:'exp', c:'生活', s:'舊分類', ns:'新分類'}, row => row.s === '新分類'],
    [{kind:'renproj', o:'舊專案', nv:'新專案'}, row => row.p === '新專案'],
    [{kind:'mvproj', o:'舊專案', nv:'新專案', d1:'2026-01-01'}, row => row.p === '新專案'],
  ]) {
    const f = fixture();
    await f.run("mutate([{id:'r1', a:'cash', t:'支出', c:'生活', s:'舊分類', p:'舊專案', n:'測試記錄', dt:'2026-01-01', m:10}])");
    const doc = command(data);
    doc.ref.fail = true;
    await process(f, doc);
    assert.equal(doc.ref.deletes, 1, data.kind);
    assert.ok(expected(f.rec.get('r1'), f), data.kind);
    const writes = f.Cloud.writes.length;
    doc.ref.fail = false;
    await process(f, doc);
    assert.equal(f.Cloud.writes.length, writes, data.kind);
    assert.equal(doc.ref.deletes, 2, data.kind);
  }
});

test('子類別改名寫入一半後保留待核對指令', async () => {
  const f = fixture();
  await f.run("mutate([{id:'r1', t:'支出', c:'生活', s:'舊分類',dt:'2026-01-01'}])");
  const doc = command({kind:'rensub', k:'exp', c:'生活', s:'舊分類', ns:'新分類'});
  f.DB.failKV = true;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(f.rec.get('r1').s, '新分類');
  assert.deepEqual(f.S.cats.exp[0].subs, ['舊分類']);
  f.DB.failKV = false;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(doc.data()._ledgerInbox.state,'review');
  assert.equal(f.Cloud.writes.filter(row => row.id).length, 2);
});

test('本機已寫入但雲端確認中斷，重開時保留指令供核對', async () => {
  const storage = {kv:new Map()};
  const first = fixture(storage);
  const doc = command({kind:'gold',q:3});
  first.Cloud.canSync = false;
  await process(first, doc);
  assert.equal(first.Cloud.writes.length, 1);
  const reopened = fixture(storage);
  await process(reopened, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(reopened.Cloud.writes.length, 0);
  assert.match(reopened.Cloud.inboxErr, /已被領取或待核對/);
});

test('雙裝置使用同一個 Firestore 指令，只有領取成功的裝置寫入', async () => {
  const a=fixture(), b=fixture();
  const doc=command({kind:'gold',q:3});
  a.Cloud.canSync=b.Cloud.canSync=false;
  await Promise.all([process(a,doc),process(b,doc)]);
  assert.equal(a.Cloud.writes.length+b.Cloud.writes.length,1);
  assert.equal(doc.data()._ledgerInbox.state,'processing');
  assert.equal(doc.ref.deletes,0);
});

test('交易領取提交後立即中斷，其他裝置保留指令', async () => {
  const owner=fixture(), reopened=fixture();
  const doc=command({kind:'gold',q:3});
  owner.context.doc=doc;
  await owner.run("claimInbox(doc.db,doc.ref,'terminated-session')");
  await process(reopened,doc);
  assert.equal(reopened.Cloud.writes.length,0);
  assert.equal(doc.ref.deletes,0);
});

test('Firestore 不允許領取時，沒有任何本機寫入', async () => {
  const f=fixture();
  const doc=command({kind:'gold',q:3});
  doc.db.denied=true;
  await process(f,doc);
  assert.equal(f.Cloud.writes.length,0);
  assert.equal(doc.ref.deletes,0);
  assert.match(f.Cloud.inboxErr,/Firestore 規則/);
});


test('通知用各自的收件證據區分 Claude 與 ChatGPT', () => {
  const f = fixture();
  const chatgptId = 'chatgpt_' + 'a'.repeat(36);
  const oldChatGPT = {id: 'ib_' + chatgptId, tg: 'claude', o: Date.UTC(2026, 10, 19, 9, 10)};
  f.context.chatgptId = chatgptId;
  f.Cloud.inboxDocs = [{source: 'chatgpt'}, {source: 'claude', state: 'review'}];
  f.Cloud.srv = new Set();
  f.S.recs.push(oldChatGPT);
  assert.equal(f.run("inboxCommandSource(chatgptId, {kind:'exp'})"), 'chatgpt');
  assert.equal(f.run("inboxCommandSource('legacy', {kind:'px'})"), '');
  assert.equal(f.run("inboxCommandSource('legacy', {src:'ap'})"), '');
  assert.equal(f.run("inboxSourceStatus('chatgpt',Cloud,S.recs)"), '已收件，1 筆待入帳');
  assert.equal(f.run("inboxSourceStatus('claude',Cloud,S.recs)"), '1 筆待核對');
  f.Cloud.inboxDocs = [];
  assert.equal(f.run("inboxSourceStatus('chatgpt',Cloud,S.recs)"), '尚無入帳紀錄');
  f.Cloud.srv.add(oldChatGPT.id);
  assert.match(f.run("inboxSourceStatus('chatgpt',Cloud,S.recs)"), /^最近入帳 .*17:10/);
  assert.equal(f.run("inboxSourceStatus('claude',Cloud,S.recs)"), '尚無入帳紀錄');
});
