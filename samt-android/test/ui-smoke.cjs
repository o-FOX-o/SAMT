const fs=require('node:fs');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function connect(){
  let pages;
  for(let attempt=0;attempt<150;attempt++) {
    try {pages=await (await fetch('http://127.0.0.1:9222/json')).json();if(pages.some(p=>p.type==='page'))break;}catch(e){}
    await pause(200);
  }
  assert.ok(pages?.length,'Headless browser did not start.');
  const socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
  return {send,socket};
}

(async()=>{
  const {send,socket}=await connect();
  const evaluate=async expression=>{
    const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const until=async expression=>{
    for(let n=0;n<50;n++){if(await evaluate(expression))return;await pause(200);}
    throw new Error(`UI did not reach expected state: ${expression}`);
  };
  const capture=async file=>{
    const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(file,Buffer.from(result.data,'base64'));
  };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:'http://127.0.0.1:8765/index.html'});
  await until('document.querySelector("h1")?.textContent === "Today"');
  assert.equal(await evaluate('document.querySelector(".hero h2")?.textContent'),'Make the first move');
  await capture('ui-preview.png');

  await evaluate('document.querySelector(".bottom [data-route=settings]").click()');
  await evaluate('document.querySelector("[data-settings=build]").click()');
  await until('!!document.querySelector("[data-action=starter][data-id=religion]")');
  await evaluate('document.querySelector("[data-action=starter][data-id=religion]").click()');
  await until('document.querySelector("h1")?.textContent === "Blocks"');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),true,'mobile page must not overflow horizontally');
  const state=await evaluate('JSON.parse(localStorage.getItem("samt.android.v3"))');
  assert.equal(state.blocks.length,2);
  assert.equal(state.runs.filter(r=>r.status==='IN_PROGRESS').length,2);
  await capture('ui-starters.png');

  await evaluate(`[...document.querySelectorAll('article.card')].find(x=>x.querySelector('h2')?.textContent==='Daily prayer').querySelector('[data-action=block-detail]').click()`);
  await until(`document.querySelector('.section h2')?.textContent === 'Daily prayer'`);
  await evaluate(`document.querySelector('[data-action=open-run]').click()`);
  await until(`!![...document.querySelectorAll('.modal .row')].find(x=>x.querySelector('strong')?.textContent==='Dhuhr')`);
  await evaluate(`[...document.querySelectorAll('.modal .row')].find(x=>x.querySelector('strong')?.textContent==='Dhuhr').querySelector('[data-action=log-run-child]').click()`);
  await until(`document.querySelector('.modal h2')?.textContent === 'Log Dhuhr'`);
  await evaluate(`document.querySelector('[name=quantity]').value='1';document.querySelector('[name^=result_]').value='8';document.querySelector('#editor').requestSubmit()`);
  await until(`JSON.parse(localStorage.getItem('samt.android.v3')).actionLogs.length === 1`);
  const logged=await evaluate(`JSON.parse(localStorage.getItem('samt.android.v3'))`);
  assert.equal(logged.runs.find(r=>r.blockSnapshot.name==='Daily prayer').children.find(c=>c.definitionSnapshot.name==='Dhuhr').status,'DONE');

  await evaluate(`document.querySelector('.top [data-action=quick-log]').click()`);
  await until(`document.querySelector('h1')?.textContent === 'Quick log'`);
  await evaluate(`document.querySelector('.bottom [data-route=blocks]').click();document.querySelector('[data-action=new-block]').click()`);
  await until(`document.querySelector('form[data-form=block]') !== null`);
  await evaluate(`const s=document.querySelector('form[data-form=block] [name=type]');s.value='collection';s.dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="target"]').hidden`),true);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="collection action_list"]').hidden`),false);
  await evaluate(`document.querySelector('.modal [data-action=close-modal]').click()`);

  await evaluate('document.querySelector(".bottom [data-route=settings]").click()');
  await evaluate('document.querySelector("[data-settings=data]").click()');
  await until(`document.querySelector('.card h2')?.textContent === 'Backups'`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'),true,'Settings must not overflow on mobile');
  await evaluate(`const f=document.querySelector('form[data-form=manager-filter]');f.elements.query.value='Dhuhr';f.elements.type.value='actions';f.requestSubmit()`);
  await until(`document.querySelectorAll('[data-manager-select]').length === 1`);
  await evaluate(`document.querySelector('[data-manager-select]').click()`);
  await until(`document.querySelector('[data-action=manager-bulk][data-op=archive]') !== null`);
  await evaluate(`document.querySelector('[data-action=manager-bulk][data-op=archive]').click()`);
  await until(`document.querySelector('.modal h2')?.textContent === 'Archive 1 item?'`);
  await evaluate(`document.querySelector('.modal [data-action=close-modal]').click()`);
  await evaluate(`document.querySelector('[data-action=paste-backup]').click()`);
  await until(`document.querySelector('.modal h2')?.textContent === 'Paste a SAMT backup'`);
  await evaluate(`document.querySelector('.modal [data-action=close-modal]').click()`);
  await evaluate(`document.querySelector('[data-action=open-clear-data]').click()`);
  await until(`document.querySelector('.modal h2')?.textContent === 'Clear selected tracked data'`);
  await evaluate(`document.querySelector('.modal [data-action=close-modal]').click()`);
  await capture('ui-data.png');

  await evaluate('document.querySelector("[data-action=theme]").click()');
  await evaluate('document.querySelector("[data-action=theme]").click()');
  await until('document.documentElement.dataset.theme === "dark"');
  await capture('ui-dark.png');
  socket.close();
  console.log('PASS: mobile Today, prayer starter, active Runs, Data Manager, backup import, and Dark mode');
})().catch(e=>{console.error(e);process.exitCode=1;});
