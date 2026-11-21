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
    accts: [{id: 'cash', name: '現金', cur: 'TWD'}], tpls: [],
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
    DB, S, D, Cloud, crypto: require('node:crypto').webcrypto, firebase: {firestore:{FieldValue:{serverTimestamp:()=>0}}}, GOLD_U: {}, CURS:['TWD'], window: {Cloud, addEventListener() {}}, structuredClone, setTimeout, clearTimeout,
    toast() {}, ensureCats() {}, recompute() {D.live = S.recs.filter(r => !r.x)}, scheduleRender() {},
    val: r => r.m + (r.f || 0) + (r.d || 0), uid: () => require('node:crypto').randomUUID(), async fixOsGroups() {}, r2: n => n, fmt: String, TODAY: () => '2026-01-01', NOWTM: () => '12:00',
    balAt: () => D.live.reduce((sum,r) => sum + r.m, 0),
    addMonths(date, months) {return '2026-' + String(1 + months).padStart(2, '0') + '-01'}
  });
  vm.runInContext([
    section('class LocalWriteError', 'function rateOf'),
    section('let recordWrites', '/* ================= recurring'),
    section('async function renProj(', 'function ruleName('),
    section('async function renameSub(', '/* ================= record building'),
    section('const OS_RATE=', '/* ===== MOZE'),
    section('function holdCodeOf(', 'let _hsT='),
    section('const INBOX_SOURCES=', 'function inboxSharedStatus()'),
    'let inboxBusy=Promise.resolve();',
    section('const inboxAwaitingCloud=', 'function processInbox(docs)'),
    section('function processInbox(docs)', "ACT['copy-uid']")
  ].join('\n'), context);
  return {context, S, D, Cloud, DB, rec, get kv() {return storage.kv},
    run(code) {return vm.runInContext(code, context)}};
}

function command(data, id='example-command') {
  let current={...data};
  const doc = {id, data:()=>current};
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


test('ChatGPT 來源保留，舊版記錄可從 ID 識別', () => {
  const f = fixture();
  const chatgptId = 'chatgpt_' + 'a'.repeat(36);
  f.context.chatgptId = chatgptId;
  assert.equal(f.run("inboxCommandSource(chatgptId, {kind:'exp'})"), 'chatgpt');
  assert.equal(f.run("inboxCommandSource('legacy', {kind:'px'})"), '');
  assert.equal(f.run("inboxCommandSource('legacy', {src:'ap'})"), '');
  assert.equal(f.run("inboxRecordSource({id:'ib_'+chatgptId,tg:'claude'})"), 'chatgpt');
});

test('通知依實際收件匣連線顯示狀態', () => {
  const f = fixture();
  f.Cloud.online = true;
  const status = () => f.run('inboxConnectionStatus(Cloud)');
  assert.equal(status(), '檢查中');
  f.Cloud.inboxOk = Date.now();
  assert.equal(status(), '連線正常');
  f.Cloud.inboxErr = '指令待核對';
  assert.equal(status(), '連線正常');
  f.Cloud.inboxConnectionError = true;
  assert.equal(status(), '連線異常');
  f.Cloud.online = false;
  assert.equal(status(), '離線');
  f.Cloud.user = null;
  assert.equal(status(), '尚未登入');
  const notification = section('  notif:()=>', "  'notif-cloud':");
  assert.match(notification, /inboxConnectionStatus/);
  assert.doesNotMatch(notification, /最近入帳|inboxSourceStatus/);
});


test('投資市值摘要與清單依市值遞減，同額保留原順序', () => {
  const context = vm.createContext({
    mktParts: () => [
      {k: '股票', p: 'invest', v: 30, sub: ''},
      {k: '黃金', p: 'gold', v: 50, sub: ''},
      {k: '外匯', p: 'fx', v: 30, sub: ''}
    ],
    mktDate: () => '—', esc: String, fmt: String, money: String, IC: {}
  });
  const page = vm.runInContext(section('function pageMarket()', 'function pageFx()') + '\npageMarket()', context);
  const order = ['黃金', '股票', '外匯'];
  assert.deepEqual(Array.from(page.body.matchAll(/class="lbl">(黃金|股票|外匯)</g), m => m[1]), order);
  assert.deepEqual(Array.from(page.body.matchAll(/class="grow"><div>(黃金|股票|外匯)</g), m => m[1]), order);
  assert.doesNotMatch(page.body, /拖曳|mk-h/);
  assert.match(page.body, /data-act="push" data-p="invest"/);
});


test('ChatGPT 收據分項共享一組、同步後維持同組、完成憑證可去重', async () => {
  const f=fixture();
  f.S.cats.exp[0].subs.push('飲料','點心');
  const id='chatgpt_'+'b'.repeat(36);
  const lines=[{c:'生活',s:'飲料',n:'示例飲品',amt:11},{c:'生活',s:'點心',n:'示例點心*2',amt:24},{c:'生活',s:'舊分類',n:'示例商品',amt:0}];
  const data={spv:1,kind:'exp',a:'cash',cu:'TWD',dt:'2026-01-01',tm:'12:00',amt:35,n:'示例收據',p:'測試專案',sh:'測試商店',sp:JSON.stringify(lines)};
  const doc=command(data,id);
  await process(f,doc);
  assert.equal(doc.data()._ledgerInbox.state,'completed');
  assert.equal(doc.ref.deletes,0);
  assert.equal(f.rec.size,3);
  const records=[...f.rec.values()];
  assert.equal(new Set(records.map(r=>r.g)).size,1);
  assert.ok(records.every(r=>r.p==='測試專案'&&r.sh==='測試商店'&&!r.gn));
  assert.equal(records.reduce((sum,r)=>sum+r.m,0),-35);
  assert.deepEqual(records.map(r=>[r.s,Math.abs(r.m)]),[['飲料',11],['點心',24],['舊分類',0]]);
  assert.equal(f.Cloud.writes.length,3);
  await process(f,doc);
  assert.equal(f.Cloud.writes.length,3);
  const other=fixture();
  other.S.recs.push(...structuredClone(f.Cloud.writes));
  other.S.recs.forEach(r=>other.S.byId.set(r.id,r));
  assert.equal(new Set(other.S.recs.map(r=>r.g)).size,1);
  const renderGroups=records=>vm.runInNewContext(section('function gkey(', 'function grpSheet(')+'\nhomeItems(records)', {
    records, S:{search:{selMode:false}}, D:{acct:new Map()}, raw:r=>r.m, curOf:()=> 'TWD',
    homeRow:()=>{throw Error('收據不得拆為獨立列')}, grpName:()=> '示例收據', aggTxt:()=>'', ruleTag:()=>'', esc:String,
    hbadge:()=>'', money:String, projPill:()=>''
  });
  const oldRecords=other.S.recs.map(r=>({...r,gn:'舊主項名稱'}));
  const view=renderGroups(oldRecords);
  assert.equal((view.match(/data-act="grp-toggle"/g)||[]).length,1);
  assert.match(view,/>35<\/span>/);
  assert.match(view,/<div class="t">測試商店<\/div>/);
  assert.doesNotMatch(view,/舊主項名稱|示例飲品/);
  const noShop=oldRecords.map(r=>({...r,sh:''}));
  assert.match(renderGroups(noShop),/<div class="t">生活<\/div>/);
  assert.match(renderGroups(noShop.map(r=>({...r,s:'飲料'}))),/<div class="t">飲料<\/div>/);
  assert.match(renderGroups([noShop[0],{...noShop[1],c:'其他'}]),/<div class="t">多類別<\/div>/);
  const wrong=command({...data,amt:36},'chatgpt_'+'c'.repeat(36));
  await process(f,wrong);
  assert.equal(wrong.data()._ledgerInbox.state,'invalid');
  assert.equal(f.Cloud.writes.length,3);
  const probe=command({...data,kind:'split_probe'},'chatgpt_'+'d'.repeat(36));
  await process(f,probe);
  assert.equal(probe.data()._ledgerInbox.state,'completed');
  assert.equal(f.Cloud.writes.length,3);
  await f.run('mutate([],S.recs.map(r=>r.id))');
  await process(f,command(data,id));
  assert.equal(f.D.live.length,0);
  assert.equal(f.rec.size,3);
});

test('Claude 舊版 sp 保留，既有單分類照常入帳', async () => {
  const f=fixture();
  const base={kind:'exp',amt:30,a:'cash',c:'生活',s:'舊分類',dt:'2026-01-01',n:'範例'};
  await process(f,command(base,'legacy-single'));
  await process(f,command({...base,sp:JSON.stringify([{c:'生活',s:'舊分類',n:'甲',amt:10},{c:'生活',s:'舊分類',n:'乙',amt:20}])},'legacy-split'));
  assert.equal(f.D.live.length,3);
  assert.deepEqual(f.D.live.filter(r=>r.g).map(r=>[r.n,r.gn]),[['甲',undefined],['乙',undefined]]);
  assert.equal(f.D.live.find(r=>!r.g).n,'範例');
  assert.equal(f.D.live.reduce((sum,r)=>sum+r.m,0),-60);
});

test('多分類編輯沿用群組與發票，增刪分項後重新合計', () => {
  const context=vm.createContext({
    uid:(()=>{let i=0;return()=> 'row'+i++;})(),evalAmt:Number,
    form:{_edit:true,_receipt:{g:'stable',inv:'TEST',tg:'chatgpt'},kind:'inc',a:'cash',n:'測試收據',dt:'2026-01-01',
      splits:[{c:'生活',s:'飲料',n:'甲',amt:'0'},{c:'生活',s:'點心',n:'乙',amt:'9'}]}
  });
  vm.runInContext(section('function spMerge(', 'let _rcK='),context);
  vm.runInContext(section('function buildRecords0(', 'function recordToForm('),context);
  const read=()=>vm.runInContext('buildRecords0(form)',context);
  assert.equal(read().reduce((s,r)=>s+r.m,0),9);
  assert.equal(read().length,2);
  assert.deepEqual(Array.from(read(),r=>[r.n,r.gn]),[['甲',undefined],['乙',undefined]]);
  context.form.splits.splice(0,1,{c:'生活',s:'飲料',n:'丙',amt:'6'});
  assert.equal(read().reduce((s,r)=>s+r.m,0),15);
  context.form.splits.pop();
  assert.equal(read().length,1);
  assert.equal(read()[0].g,'stable');
  assert.equal(read()[0].inv,'TEST');
});

test('展開收據時同時顯示商品名稱與分類', () => {
  const view=vm.runInNewContext(section('function homeRow(', 'const homeProjOk=')+'\nhomeRow(record,"測試商品")',{
    record:{id:'line',rv:1,n:'測試商品',c:'生活',s:'飲料',t:'支出',dt:'2026-01-01',m:-20},
    TODAY:()=> '2026-01-01', curOf:()=> 'TWD', raw:r=>r.m, D:{acct:new Map()}, S:{search:{selMode:false}},
    ruleTag:()=>'', hbadge:()=>'', money:String, esc:String
  });
  assert.match(view,/>測試商品<\/div>/);
  assert.match(view,/>生活／飲料<\/div>/);
});


test('海外消費與手續費共享一組，名稱只在分項，重送不重複記帳', async () => {
  const f=fixture();
  f.S.settings.osShops=['測試商店'];
  const data={kind:'exp',amt:200,a:'cash',c:'生活',s:'舊分類',dt:'2026-01-01',n:'測試訂閱',sh:'測試商店'};
  await process(f,command(data,'overseas-test'));
  const items=[...f.rec.values()];
  assert.deepEqual(items.map(r=>[r.n,r.m,r.gn]),[['測試訂閱',-200,undefined],['海外交易手續費',-3,undefined]]);
  assert.ok(items[0].g);
  assert.equal(items[0].g,items[1].g);
  assert.ok(items[1].o>items[0].o);
  await process(f,command(data,'overseas-test'));
  assert.equal(f.rec.size,2);
  assert.equal(f.D.live.reduce((sum,r)=>sum+r.m,0),-203);
});

test('候選金額指令只修改同日、同帳戶、同分類中唯一匹配的既有交易', async () => {
  const date='2026-01-01';
  const entry={a:'cash',t:'支出',c:'投資',dt:date,m:-100};
  const first={...entry,id:'r1',n:'0050元大台灣50'};
  const second={...entry,id:'r2',n:'第一金 2892'};
  const edit={kind:'edit_match',a:'cash',c:'投資',dt:date,amt:770,names:'["0050","2892","第一金"]'};
  for(const [rows, expected] of [
    [[first,{...second,a:'other'},{...second,id:'r3',dt:'2026-01-02'},{...second,id:'r4',c:'其他'}],'completed'],
    [[first,second],'invalid'],
    [[{...first,n:'10050'}],'invalid'],
  ]) {
    const f=fixture();
    f.context.rows=rows;
    await f.run('mutate(rows)');
    const doc=command(edit,'chatgpt_'+'a'.repeat(36));
    await process(f,doc);
    assert.equal(doc.data()._ledgerInbox.state,expected);
    assert.equal(f.rec.size,rows.length);
    assert.equal(f.rec.get('r1').m,expected==='completed'?-770:-100);
    assert.equal(doc.ref.deletes,0);
    if(f.rec.has('r2'))assert.equal(f.rec.get('r2').m,-100);
    const writes=f.Cloud.writes.length;
    await process(f,doc);
    assert.equal(f.Cloud.writes.length,writes);
  }
});

test('模糊搜尋同時比對日期、時間、商家、帳戶、專案與分項', () => {
  const f=fixture();
  f.context.query={from:'2026-01-02',to:'2026-01-02',time:'12:00',end_time:'12:59',
    merchant:'kk day',account:'測試銀行',project:'旅遊',item:'0050',amount:208};
  const matching={a:'account',dt:'2026-01-02',tm:'12:30',n:'００５０ 元大台灣50',sh:'KKday',p:'國內旅遊',m:-208};
  f.context.rows=[matching,{...matching,tm:'13:00'},{...matching,p:'居家'},{...matching,n:'2892'},{...matching,a:'other'}];
  f.context.accounts=new Map([['account',{name:'測試銀行證券',cur:'TWD'}]]);
  const result=f.run('ledgerSearchRows(query,rows,accounts)');
  assert.equal(result.total,1);
  assert.equal(result.rows[0].name,matching.n);
  assert.equal(result.rows[0].amount,208);
  assert.equal(result.rows[0].project,matching.p);
  assert.equal(f.run('ledgerSearchRows(query,Array(13).fill(rows[0]),accounts).rows.length'),5);
});

test('修改提示依指令來源顯示 ChatGPT 或 Claude', async () => {
  for(const [id,label] of [['chatgpt_'+'a'.repeat(36),'ChatGPT'],['claude-edit','Claude']]){
    const f=fixture();
    const messages=[];
    f.context.toast=message=>messages.push(message);
    await f.run("mutate([{id:'r1',a:'cash',t:'支出',c:'生活',s:'舊分類',n:'測試記錄',dt:'2026-01-01',m:-10}])");
    await process(f,command({kind:'edit',n:'測試記錄',dt:'2026-01-01',amt:20},id));
    assert.equal(f.rec.get('r1').m,-20);
    assert.ok(messages.some(message=>message.startsWith(label+' 幫你修改了')));
  }
});

test('股票買入保存成交股數，改金額依原單價調整持股', async () => {
  const f=fixture();
  f.S.cats.exp.push({n:'投資',subs:['股票買入']});
  const data={kind:'stock_buy',amt:1000,a:'cash',c:'投資',s:'股票買入',n:'0050 測試股票',dt:'2026-01-01',hsq:10};
  const id='chatgpt_'+'e'.repeat(36);
  await process(f,command({...data,hsq:1.5},'invalid-shares'));
  assert.equal(f.rec.size,0);
  await process(f,command(data,id));
  const record=f.rec.get('ib_'+id);
  assert.deepEqual([record.m,record.hsc,record.hsq,record.hsa],[-1000,'0050',10,1000]);
  let today='2026-01-01';
  const c=vm.createContext({S:f.S,D:f.D,PX:null,HOLD_FROM:'2026-01-01',TODAY:()=>today,uid:()=> 'test-holding',
    fetch:async()=>({ok:false}),PRICE_URL:'https://example.test',toast() {},render() {},async saveKV() {},clearTimeout,setTimeout,setInterval() {}});
  vm.runInContext(section('function validTradeShares(', 'function isRetainedInbox(')+
    section('function holdCodeOf(', '/* ---------- 存錢目標'),c);
  f.S.ready=true;
  await vm.runInContext('holdSync()',c);
  assert.equal(f.S.settings.hold[0].sh,10);
  await process(f,command({kind:'edit',dt:data.dt,n:data.n,amt:1500},'test-edit'));
  await vm.runInContext('holdSync()',c);
  assert.equal(f.S.settings.hold[0].sh,10);
  today='2026-01-02';
  c.PX={d:today,p:{'0050':['測試股票',95,'TWD',today]}};
  await vm.runInContext('holdSync()',c);
  assert.equal(f.S.settings.hold[0].sh,10);
  c.PX={d:today,p:{'0050':['測試股票',95,'TWD','2026-01-01']}};
  await vm.runInContext('holdSync()',c);
  await vm.runInContext('holdSync()',c);
  assert.equal(f.S.settings.hold[0].sh,15);
  f.context.deletedId='ib_'+id;
  await f.run('mutate([], [deletedId])');
  await vm.runInContext('holdSync()',c);
  assert.equal(f.S.settings.hold[0].sh,0);
});

test('發票可在原群組展開為各品項，維持原總額與分項專案', async () => {
  const f=fixture();
  const original='chatgpt_'+'a'.repeat(36), revise='chatgpt_'+'b'.repeat(36);
  const base={spv:1,kind:'exp',a:'cash',cu:'TWD',dt:'2026-01-01',tm:'13:30',sh:'示例商家',n:'示例',inv:'AB-00000001',amt:30};
  const line=(n,amt,p)=>({c:'生活',s:'舊分類',n,amt,...(p?{p}:{})});
  await process(f,command({...base,sp:JSON.stringify([line('食材',30)])},original));
  const input={...base,kind:'split_revise',target:original,sp:JSON.stringify([line('示例甲',20,'示例專案'),line('示例乙',10)])};
  const wrong=command({...input,sh:'其他商家'},'chatgpt_'+'c'.repeat(36));
  await process(f,wrong);
  assert.equal(wrong.data()._ledgerInbox.state,'invalid');
  const doc=command(input,revise);
  await process(f,doc);
  assert.equal(doc.data()._ledgerInbox.state,'completed');
  assert.equal(f.D.live.length,2);
  assert.deepEqual(f.D.live.map(r=>[r.n,r.m,r.p]),[['示例甲',-20,'示例專案'],['示例乙',-10,'']]);
  assert.ok(f.D.live.every(r=>r.g==='ib_'+original+'_split'));
  await process(f,doc);
  assert.equal(f.D.live.length,2);
});
