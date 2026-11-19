const test=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('../natural-ledger.js');
const accounts=[
  {id:'securities',name:'國泰世華證券戶',arch:0},
  {id:'wallet',name:'錢包',arch:0},
  {id:'old',name:'舊帳戶',arch:1}
];
const now=new Date(2026,10,19,15,30);
test('股票股利：12/10、00:00、10 元、正確帳戶及標的',()=>{
  const r=parse('收入：12/10，00:00，10元，股票股利，國泰世華證券戶，富邦台灣50',accounts,now);
  assert.equal(r.error,undefined);
  assert.equal(r.kind,'inc');
  assert.equal(r.dt,'2026-12-10');
  assert.equal(r.tm,'00:00');
  assert.equal(r.amt,'10');
  assert.equal(r.a,'securities');
  assert.equal(r.s,'股利');
  assert.equal(r.n,'富邦台灣50');
});
test('自然語言敘述股利與名稱不應把日期或金額混進名稱',()=>{
  const r=parse('12月10日 00:00，富邦台灣50股利10元，國泰世華證券戶',accounts,now);
  assert.equal(r.error,undefined);
  assert.equal(r.n,'富邦台灣50');
  assert.equal(r.amt,'10');
  assert.equal(r.dt,'2026-12-10');
});
test('日常支出解析與千分位',()=>{
  const r=parse('今天中午午餐1,200元，錢包',accounts,now);
  assert.equal(r.kind,'exp');
  assert.equal(r.amt,'1200');
  assert.equal(r.c,'飲食');
  assert.equal(r.s,'午餐');
  assert.equal(r.a,'wallet');
});
test('不匹配不存在的帳戶',()=>assert.match(parse('12/10 10元，未知銀行',accounts,now).error,/帳戶/));
test('不存在金額時不能建立',()=>assert.match(parse('午餐，錢包',accounts,now).error,/金額/));
test('不合法日期不能建立',()=>assert.match(parse('2026/02/30 午餐 100元 錢包',accounts,now).error,/日期/));
test('不匹配封存帳戶',()=>assert.match(parse('今天100元舊帳戶',accounts,now).error,/帳戶/));
test('輸入過長會拒絕',()=>assert.match(parse('x'.repeat(610),accounts,now).error,/過長/));
