const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(localhost|127\.0\.0\.1):[0-9]+$/);
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc, getDoc, getDocFromServer, runTransaction, serverTimestamp, setDoc, updateDoc} = require('firebase/firestore');

test('Firestore 交易競爭及收件匣規則', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-ledger-inbox',
    firestore: {rules: readFileSync(__dirname + '/inbox.test.rules', 'utf8')},
  });
  try {
    const path = 'users/fixture-owner/inbox/cmd';
    const owner = env.authenticatedContext('fixture-owner').firestore();
    const second = env.authenticatedContext('fixture-owner').firestore();
    const other = env.authenticatedContext('someone-else').firestore();
    const bot = env.authenticatedContext('fixture-bot').firestore();
    const one='10000000-0000-4000-8000-000000000001';
    const two='10000000-0000-4000-8000-000000000002';
    function marker(token, state) {
      return {_ledgerInbox: {token, state, at:serverTimestamp()}};
    }
    await assertFails(setDoc(doc(bot,path),{kind:'gold',...marker(one,'processing')}));
    await assertSucceeds(setDoc(doc(bot,path),{kind:'gold',q:1}));
    await assertFails(getDoc(doc(bot,path)));
    await assertFails(getDoc(doc(other,path)));
    await assertFails(updateDoc(doc(other,path),marker(one,'processing')));
    await assertFails(updateDoc(doc(bot,path),marker(one,'processing')));
    await assertFails(updateDoc(doc(owner,path),{q:9,...marker(one,'processing')}));
    await assertFails(updateDoc(doc(owner,path),marker(one,'completed')));
    const app = readFileSync(__dirname + '/../../index.html','utf8');
    const claimSource = app.slice(app.indexOf('async function claimInbox('), app.indexOf('async function executeInbox('));
    const claimInbox = vm.runInNewContext(claimSource+'\nclaimInbox', {
      firebase:{firestore:{FieldValue:{serverTimestamp}}}, setTimeout, clearTimeout,
    });
    function claim(db,token) {
      const ref=doc(db,path);
      const adapter={runTransaction:fn=>runTransaction(db,tx=>fn({
        get:async()=>{
          const snap=await tx.get(ref);
          return {exists:snap.exists(),data:()=>snap.data()};
        },
        update:(_,data)=>tx.update(ref,{_ledgerInbox:{...data._ledgerInbox}}),
      }))};
      const compatRef={get:async()=>{
        const snap=await getDocFromServer(ref);
        return {exists:snap.exists(),data:()=>snap.data()};
      }};
      return claimInbox(adapter,compatRef,token);
    }
    const outcomes=await Promise.all([claim(owner,one),claim(second,two)]);
    const results=outcomes.map(result=>result.state==='claimed');
    assert.equal(results.filter(Boolean).length,1);
    assert.equal(outcomes.find(result=>result.state!=='claimed').state,'processing');
    const winner=results[0]?one:two;
    const loser=results[0]?two:one;
    await assertFails(updateDoc(doc(owner,path),marker(loser,'completed')));
    await assertFails(updateDoc(doc(owner,path),marker(loser,'processing')));
    await assertSucceeds(updateDoc(doc(owner,path),marker(winner,'completed')));
    await assertFails(updateDoc(doc(owner,path),marker(winner,'processing')));
    for(const state of ['invalid','review']){
      const held=path+'-'+state;
      await assertSucceeds(setDoc(doc(bot,held),{kind:'gold',q:1}));
      await assertSucceeds(updateDoc(doc(owner,held),marker(winner,'processing')));
      await assertSucceeds(updateDoc(doc(owner,held),marker(winner,state)));
      await assertFails(updateDoc(doc(owner,held),marker(winner,'processing')));
    }
  } finally {
    await env.cleanup();
  }
});
