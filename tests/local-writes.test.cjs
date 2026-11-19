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

function fixture() {
  const rec = new Map();
  let kv = new Map();
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
    async getKV(key) {return kv.get(key)},
    async putKV(key, value) {
      if(this.failKV)throw new Error('mock KV abort');
      kv.set(key, structuredClone(value));
    },
    async run(stores, callback) {
      const writes = new Map(kv), requests = [];
      const store = {
        get(key) {const request = {result: writes.get(key)};requests.push(request);return request},
        put(value, key) {writes.set(key, structuredClone(value))}
      };
      callback({objectStore: () => store});
      requests.forEach(r => r.onsuccess());
      if(this.failKV)throw new Error('mock KV abort');
      kv = writes;
    }
  };
  const context = vm.createContext({
    DB, S, D, Cloud, GOLD_U: {}, window: {Cloud, addEventListener() {}}, structuredClone, setTimeout, clearTimeout,
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
    'let inboxBusy=Promise.resolve();',
    section('const inboxSeen=', 'function processInbox(docs)'),
    section('function processInbox(docs)', "ACT['copy-uid']")
  ].join('\n'), context);
  return {context, S, Cloud, DB, rec, get kv() {return kv},
    run(code) {return vm.runInContext(code, context)}};
}

function command(data) {
  const doc = {id: 'example-command', data: () => data};
  doc.ref = {id: doc.id, deletes: 0, fail: false, async delete() {
    this.deletes++;
    if(this.fail)throw new Error('mock Firestore delete failure');
  }};
  return doc;
}
async function process(f, doc) {
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

test('分期記錄完成但規則寫入中止，重試只補規則', async () => {
  const f = fixture();
  const doc = command({kind: 'inst', n: '測試分期', a: 'cash', cnt: 4, sno: 2, amt: 10, dt: '2026-01-01'});
  f.DB.failKV = true;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 0);
  assert.equal(f.S.rules.length, 0);
  assert.deepEqual([...f.rec.keys()], ['ib_example-command_i2','ib_example-command_i3','ib_example-command_i4']);
  f.DB.failKV = false;
  await process(f, doc);
  assert.equal(doc.ref.deletes, 1);
  assert.equal(f.kv.get('rules').length, 1);
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
  await second.DB.putKV('inboxReceipts/example-user', first.kv.get('inboxReceipts/example-user'));
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
    assert.match(f.Cloud.inboxErr, /已保留待檢查的指令/);
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

test('子類別改名寫入一半後可重試儲存分類，不會再改一次記錄', async () => {
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
  assert.equal(doc.ref.deletes, 1);
  assert.deepEqual(f.kv.get('cats').exp[0].subs, ['新分類']);
  assert.equal(f.Cloud.writes.filter(row => row.id).length, 2);
});
