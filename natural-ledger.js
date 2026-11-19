/* 自然語言／語音記帳：只做本機解析與預填，實際寫入仍由原本記帳表單確認。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.NaturalLedger=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const pad=n=>String(n).padStart(2,'0');
  function validDate(y,m,d){
    const v=new Date(y,m-1,d);
    return y>=2000&&y<=2100&&v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d;
  }
  function parse(input,accounts=[],today=new Date()){
    const raw=String(input||'').trim();
    if(!raw)return{error:'請輸入一筆記帳內容'};
    if(raw.length>600)return{error:'內容過長，請一次輸入一筆交易'};
    const kind=/股利|配息|薪資|薪水|入帳|退款|收入|獎金|利息收入/.test(raw)?'inc':'exp';
    const d4=/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/.exec(raw);
    const d2=!d4&&/(\d{1,2})[\/\-.月](\d{1,2})日?/.exec(raw);
    let y=today.getFullYear(),m=today.getMonth()+1,d=today.getDate();
    let consumedDate='';
    if(d4){y=+d4[1];m=+d4[2];d=+d4[3];consumedDate=d4[0]}
    else if(d2){m=+d2[1];d=+d2[2];consumedDate=d2[0]}
    else if(/昨天/.test(raw)){const v=new Date(y,m-1,d-1);y=v.getFullYear();m=v.getMonth()+1;d=v.getDate();consumedDate='昨天'}
    else if(/明天/.test(raw)){const v=new Date(y,m-1,d+1);y=v.getFullYear();m=v.getMonth()+1;d=v.getDate();consumedDate='明天'}
    else if(/今天/.test(raw))consumedDate='今天';
    if(!validDate(y,m,d))return{error:'日期不正確，請重新輸入'};
    const dt=y+'-'+pad(m)+'-'+pad(d);
    let tm=pad(today.getHours())+':'+pad(today.getMinutes()),timeToken='';
    const clock=/\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(raw);
    if(clock){tm=pad(+clock[1])+':'+clock[2];timeToken=clock[0]}
    const money=/(?:NT\$|NTD\s*|新臺幣\s*|台幣\s*|金額[:：]?\s*)\$?\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:元|塊)/i.exec(raw);
    if(!money)return{error:'找不到金額，請輸入例如「10元」或「NT$10」'};
    const amount=Number((money[1]||money[2]).replace(/,/g,''));
    if(!Number.isFinite(amount)||amount<=0||amount>1e10)return{error:'金額不正確'};
    const usable=accounts.filter(a=>!a.arch);
    const matches=usable.filter(a=>raw.includes(a.name));
    if(matches.length===0)return{error:'找不到對應帳戶，請在文字中輸入記帳 App 內完整的帳戶名稱'};
    matches.sort((a,b)=>b.name.length-a.name.length);
    if(matches.length>1&&!matches.every(a=>matches[0].name.includes(a.name)))
      return{error:'出現多個帳戶名稱，請一次只指定一個入帳帳戶'};
    const account=matches[0];
    let c='',s='',name='';
    const dividend=/股票股利|現金股利|股息|股利|配息/.test(raw);
    if(dividend){c='收入';s='股利'}
    else if(/薪資|薪水/.test(raw)){c='收入';s='薪資'}
    else if(/早餐|午餐|晚餐|宵夜/.test(raw)){c='飲食';s=(/早餐|午餐|晚餐|宵夜/.exec(raw)||[])[0]}
    else if(/加油/.test(raw)){c='交通';s='加油'}
    else if(/飲料|咖啡/.test(raw)){c='飲食';s='飲料'}
    else {c=kind==='inc'?'收入':'日常';s=kind==='inc'?'其他收入':'其他'}
    let remaining=raw;
    for(const token of [consumedDate,timeToken,money[0],account.name,'股票股利','現金股利','股息','股利','配息','薪資','薪水','入帳','收入','支出','退款','今天','昨天','明天']){
      if(token)remaining=remaining.replace(token,' ');
    }
    remaining=remaining.replace(/[：:,，。；;、\s]+/g,' ').trim();
    name=remaining||s||c;
    // 不憑空產生不存在的帳戶；分類仍須在原本編輯表單確認。
    return{kind,amt:String(amount),dt,tm,a:account.id,accountName:account.name,c,s,n:name,original:raw};
  }
  function open(){
    const ledger=window.__ledger;
    if(!ledger||!ledger.S||!ledger.quickOpen)return;
    const S=ledger.S;
    if(!S.accts.length){alert('請先在 App 建立記帳帳戶');return}
    const old=document.getElementById('nl-overlay');if(old)old.remove();
    const overlay=document.createElement('div');
    overlay.id='nl-overlay';overlay.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
    const card=document.createElement('div');
    card.style.cssText='background:var(--paper,#fff);color:var(--ink,#222);width:min(100%,540px);padding:20px 18px calc(24px + env(safe-area-inset-bottom,0px));border-radius:20px 20px 0 0;box-shadow:0 -8px 30px #0002;max-height:80vh;overflow:auto';
    const title=document.createElement('h2');title.textContent='自然語言記帳';title.style.cssText='margin:0 0 8px;font-size:20px';
    const hint=document.createElement('p');hint.textContent='說一句話或貼上文字，解析後進入原本記帳表單確認，才會正式儲存。';hint.style.cssText='font-size:13px;line-height:1.5;opacity:.78';
    const area=document.createElement('textarea');area.id='nl-input';area.rows=4;area.placeholder='例如：12/10 00:00，富邦台灣50股利10元，國泰世華證券戶';area.style.cssText='width:100%;box-sizing:border-box;border:1px solid var(--rule,#ccc);border-radius:10px;padding:12px;font-size:16px;background:var(--paper2,#fafafa);color:inherit;resize:vertical';
    const info=document.createElement('p');info.id='nl-info';info.style.cssText='min-height:22px;font-size:13px;line-height:1.5';
    const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
    function btn(label){const b=document.createElement('button');b.type='button';b.textContent=label;b.className='btn';b.style.cssText='flex:1;min-width:80px';return b}
    const voice=btn('🎤 語音'),next=btn('解析並檢查'),cancel=btn('取消');
    next.className='btn pri';
    actions.append(voice,next,cancel);card.append(title,hint,area,info,actions);overlay.append(card);document.body.append(overlay);
    const close=()=>{try{recognition&&recognition.stop()}catch(e){}overlay.remove()};
    cancel.onclick=close;
    overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
    let recognition=null;
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Speech){voice.textContent='使用鍵盤語音輸入';voice.onclick=()=>{area.focus();info.textContent='此瀏覽器沒有內建語音辨識 API，請點鍵盤的麥克風說話。'}}
    else voice.onclick=()=>{
      if(recognition){recognition.stop();return}
      recognition=new Speech();recognition.lang='zh-TW';recognition.interimResults=false;recognition.maxAlternatives=1;
      recognition.onresult=e=>{const t=e.results[0][0].transcript;area.value=(area.value?area.value+'，':'')+t;info.textContent='已辨識語音，請檢查內容後解析'};
      recognition.onerror=e=>{info.textContent='語音辨識失敗：'+e.error+'。可改用鍵盤麥克風。'};
      recognition.onend=()=>{recognition=null;voice.textContent='🎤 語音'};
      try{recognition.start();voice.textContent='停止錄音'}catch(e){info.textContent='無法啟動語音輸入，可改用鍵盤麥克風'}
    };
    next.onclick=()=>{
      const result=parse(area.value,S.accts);
      if(result.error){info.textContent='⚠ '+result.error;return}
      const cats=S.cats[result.kind]||[];
      const rootCat=cats.find(x=>x.n===result.c);
      const dividendCat=result.kind==='inc'&&result.s==='股利'?
        cats.find(x=>x.subs&&(x.subs.includes('股票股利')||x.subs.includes('股利'))):null;
      const picked=dividendCat||rootCat||cats.find(x=>x.subs&&x.subs.includes(result.s))||cats[0];
      if(!picked){info.textContent='請先在 App 設定收入或支出分類';return}
      const sub=result.s==='股利'&&picked.subs?.includes('股票股利')?'股票股利':
        picked.subs?.includes(result.s)?result.s:(picked.subs?.[0]||'');
      const f=ledger.quickBlank(result.kind);
      Object.assign(f,{a:result.a,amt:result.amt,c:picked.n,s:sub,n:result.n,dt:result.dt,tm:result.tm});
      close();
      ledger.quickOpen(f);
      // 分類可能與口語推測不同，要求使用者在原表單中確認。
      const note=document.createElement('div');note.textContent='請檢查帳戶、分類、名稱、日期及金額，再按右上角 ✓ 儲存';note.style.cssText='padding:8px 12px;font-size:13px;background:var(--paper2,#eee)';
      const sb=document.getElementById('sb');if(sb)sb.prepend(note);
    };
    setTimeout(()=>area.focus(),100);
  }
  return{parse,open};
});
