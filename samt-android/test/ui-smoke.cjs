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
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
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
  assert.equal(await evaluate('document.querySelector(".bearing-panel h2")?.textContent'),'Make the first move');
  assert.equal(await evaluate('document.documentElement.dataset.layout'),'orbit');
  await capture('ui-preview.png');

  await evaluate('document.querySelector(".bottom [data-route=settings]").click()');
  await until('document.querySelectorAll("[data-action=set-layout]").length === 5');
  assert.equal(await evaluate('document.querySelectorAll("[data-action=set-palette]").length >= 10'),true);
  for(const layout of ['simple','command','journal','matrix','orbit']){
    await evaluate(`document.querySelector('[data-action=set-layout][data-id=${layout}]').click()`);
    await until(`document.documentElement.dataset.layout === "${layout}"`);
    await evaluate('document.querySelector(".bottom [data-route=home]").click()');
    await until(`document.querySelector('.home-${layout}') !== null`);
    await capture(`ui-layout-${layout}.png`);
    await evaluate('document.querySelector(".bottom [data-route=settings]").click()');
    await until('document.querySelectorAll("[data-action=set-layout]").length === 5');
  }
  await evaluate('document.querySelector("[data-action=set-palette][data-id=ocean]").click()');
  await until('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() === "#1976a3"');
  await evaluate('document.querySelector("[data-action=set-palette][data-id=samt]").click()');
  await until('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() === "#147d86"');
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
  await evaluate(`[...document.querySelectorAll('.card .row')].find(x=>x.querySelector('strong')?.textContent==='Dhuhr').querySelector('[data-action=edit-child]').click()`);
  await until(`document.querySelector('.modal h2')?.textContent === 'Edit linked child'`);
  await evaluate(`document.querySelector('[name=time]').value='13:00';document.querySelector('[name=alarm]').checked=true;document.querySelector('#editor').requestSubmit()`);
  await until(`JSON.parse(localStorage.getItem('samt.android.v3')).blocks.find(b=>b.name==='Daily prayer').relationships.find(r=>JSON.parse(localStorage.getItem('samt.android.v3')).actions.find(a=>a.id===r.refId)?.name==='Dhuhr').config.alarm === true`);

  await evaluate(`document.querySelector('.top [data-action=quick-log]').click()`);
  await until(`document.querySelector('h1')?.textContent === 'Quick log'`);
  await evaluate(`document.querySelector('.bottom [data-route=blocks]').click();document.querySelector('[data-action=new-block]').click()`);
  await until(`document.querySelector('form[data-form=block]') !== null`);
  await evaluate(`const s=document.querySelector('form[data-form=block] [name=type]');s.value='collection';s.dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="target"]').hidden`),true);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="collection action_list"]').hidden`),false);
  await evaluate(`document.querySelector('.modal [data-action=close-modal]').click()`);

  // Project has its own persistent-outcome editor rather than inheriting Routine semantics.
  await evaluate(`document.querySelector('[data-action=new-block]').click()`);
  await until(`document.querySelector('form[data-form=block]') !== null`);
  await evaluate(`(()=>{const projectType=document.querySelector('form[data-form=block] [name=type]');projectType.value='project';projectType.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="project"]').hidden`),false);
  assert.equal(await evaluate(`document.querySelector('[data-block-types="routine workflow"]').hidden`),true);
  assert.equal(await evaluate(`document.querySelector('form[data-form=block]').elements.projectConditionMode.value`),'all');
  assert.equal(await evaluate(`document.querySelector('form[data-form=block]').elements.projectResultCondition !== undefined`),true);
  await evaluate(`(()=>{const projectForm=document.querySelector('form[data-form=block]');projectForm.elements.name.value='Ship beta';projectForm.elements.projectOutcome.value='Stable Android beta';projectForm.elements.projectRequirements.value='Green build';projectForm.elements.projectDeadlineMode.value='relative';projectForm.elements.projectDeadlineDays.value='2';projectForm.elements.projectConditionMode.value='any';projectForm.elements.primary.checked=true;projectForm.requestSubmit()})()`);
  await until(`JSON.parse(localStorage.getItem('samt.android.v3')).blocks.some(b=>b.name==='Ship beta')`);
  const projectDef=await evaluate(`JSON.parse(localStorage.getItem('samt.android.v3')).blocks.find(b=>b.name==='Ship beta')`);
  assert.equal(projectDef.type,'project');
  assert.equal(projectDef.config.outcome,'Stable Android beta');
  assert.equal(projectDef.config.deadlineOffsetMinutes,2880);
  assert.equal(projectDef.config.finishBehavior,'ready_to_finish');
  assert.equal(projectDef.config.conditionMode,'any');
  assert.equal(projectDef.config.conditions[0].type,'required');
  await evaluate(`[...document.querySelectorAll('article.card')].find(x=>x.querySelector('h2')?.textContent==='Ship beta').querySelector('[data-action=block-detail]').click()`);
  await until(`!![...document.querySelectorAll('.card h2')].find(x=>x.textContent==='Project brief')`);
  assert.equal(await evaluate(`document.body.textContent.includes('Stable Android beta')`),true);
  await evaluate(`document.querySelector('[data-action=back-blocks]').click()`);

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
  console.log('PASS: visual layouts/palettes, mobile Today, prayer starter, active Runs, Project editor, Data Manager, backup import, and Dark mode');
})().catch(e=>{console.error(e);process.exit(1);});
