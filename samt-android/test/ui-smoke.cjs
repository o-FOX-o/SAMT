const fs=require('node:fs');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function connect(){
  let pages;
  for(let attempt=0;attempt<50;attempt++) {
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
  const state=await evaluate('JSON.parse(localStorage.getItem("samt.android.v3"))');
  assert.equal(state.blocks.length,2);
  assert.equal(state.runs.filter(r=>r.status==='IN_PROGRESS').length,2);
  await capture('ui-starters.png');

  await evaluate('document.querySelector("[data-action=theme]").click()');
  await evaluate('document.querySelector("[data-action=theme]").click()');
  await until('document.documentElement.dataset.theme === "dark"');
  await capture('ui-dark.png');
  socket.close();
  console.log('PASS: mobile Today, editable prayer starter, active Runs, and Dark mode');
})().catch(e=>{console.error(e);process.exitCode=1;});
