import {TYPES,RESULT_TYPES,emptyState,validate,execute,reconcile,periodBounds,localKey,overview,actionAnalysis,home,alarmRequests,backup,importBackup,definitionImpact,dataClearImpact} from './engine.js';
import {LAYOUTS,TYPOGRAPHIES,PALETTES,FULL_PRESETS,visualSettings,resolvedAppearance,applyVisual,presetFromSettings,parseStylePreset} from './visual.js';

const KEY='samt.android.v3';const root=document.getElementById('app');
const H=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=(v)=>v?new Date(v).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const inputDateTime=(value=Date.now())=>{const x=new Date(value),pad=n=>String(n).padStart(2,'0');return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;};
const short=(v)=>v?new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
const title=s=>s.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());
const csvNumbers=value=>{const raw=String(value??'').trim();return raw?raw.split(',').map(x=>Number(x.trim())).filter(Number.isFinite):[];};
const names={home:'Today',actions:'Actions',blocks:'Blocks',log:'Quick log',activity:'History & analysis',settings:'Settings'};
const nav=[['home','home','Today'],['actions','actions','Actions'],['blocks','blocks','Blocks'],['activity','activity','Activity'],['settings','settings','Settings']];
const iconPath={home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/>',actions:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',blocks:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',activity:'<path d="M4 20h16M7 17v-5m5 5V5m5 12V9"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1"/>'};
const navIcon=key=>`<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPath[key]}</svg>`;
const icons={collection:'▤',action_list:'☑',routine:'↻',workflow:'⇢',project:'◇',cycle:'◉',target:'◎'};
const colors={collection:'var(--type-collection)',action_list:'var(--type-action-list)',routine:'var(--type-routine)',workflow:'var(--type-workflow)',project:'var(--type-project)',cycle:'var(--type-cycle)',target:'var(--type-target)'};
let state,recovery=null,route='home',detail=null,modal=null,toast=null,tab='all',activityTab='history',settingsTab='style',stylePanel='overview',draftResults=[],actionReturn=null,temporary=false;
let dataFilter={query:'',type:'all',status:'all',usage:'all'},dataSelected=new Set(),binFilter={query:'',type:'all'},binSelected=new Set();
try{const native=window.SamtAndroid?.loadState?.();const raw=native||localStorage.getItem(KEY);state=raw?JSON.parse(raw):emptyState();validate(state);}catch(e){recovery=e;state=emptyState();}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));temporary=false;}catch(e){temporary=true;show('Storage unavailable: export a backup before closing.','bad');}}
function save(){persist();syncNative();render();}
function refreshFromPhone(){
 const raw=window.SamtAndroid?.loadState?.();if(!raw)return;
 const onPhone=JSON.parse(raw);validate(onPhone);
 if(Date.parse(onPhone.meta?.updatedAt||0)>Date.parse(state.meta?.updatedAt||0))state=onPhone;
}
function command(type,extra={}){try{refreshFromPhone();const result=execute(state,{type,...extra},Date.now());state=result.state;save();return result.value;}catch(e){show(e.message||String(e),'bad');return null;}}
function syncNative(){if(!window.SamtAndroid)return;try{if(!window.SamtAndroid.saveState(JSON.stringify(state)))throw new Error('Phone storage refused the change.');if(window.SamtAndroid.scheduleAlarms(JSON.stringify(alarmRequests(state,Date.now())))===false)throw new Error('Android could not schedule the alarms.');}catch(e){temporary=true;show(`Phone storage or alarm sync needs attention: ${e.message}`,'bad');}}
function show(message,kind='good'){
  toast={message,kind};let element=document.querySelector('.toast');
  if(!element){element=document.createElement('div');element.className='toast';element.setAttribute('role','status');document.body.appendChild(element);}
  element.textContent=message;element.dataset.kind=kind;
  const current=toast;setTimeout(()=>{if(toast===current){toast=null;document.querySelector('.toast')?.remove();}},3600);
}
function navigate(to,chosen=null){route=to;detail=chosen;modal=null;render();window.scrollTo({top:0,behavior:'instant'});}
function closeEditorModal(){
 if(modal?.kind==='result'&&actionReturn){const draft=actionReturn;actionEditor(draft.id?state.actions.find(x=>x.id===draft.id):null);draftResults=draft.results;const restored=document.querySelector('#editor');for(const [name,v] of Object.entries(draft.values)){const el=restored.elements.namedItem(name);if(el){if(el.type==='checkbox')el.checked=!!v;else el.value=v;}}document.querySelector('#result-list').innerHTML=resultDraftHtml();actionReturn=null;return;}
 modal=null;render();
}
function handleBack(){
 if(modal){closeEditorModal();return true;}
 if(route==='blocks'&&detail){navigate('blocks');return true;}
 if(route!=='home'){navigate('home');return true;}
 return false;
}
window.SamtBack=handleBack;
const prefersDark=()=>matchMedia('(prefers-color-scheme: dark)').matches;
function theme(){return resolvedAppearance(state.settings,prefersDark());}
function currentVisual(){return visualSettings(state.settings);}
function currentPalette(){return currentVisual().palette;}
function downloadJson(name,content){
 if(window.SamtAndroid){window.SamtAndroid.exportFile(name,'application/json',content);return;}
 const blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportStylePreset(){
 const preset=presetFromSettings(state.settings,state.settings.categoryColors||{}),safe=(preset.name||'SAMT-style').replace(/[^a-z0-9_-]+/gi,'-');
 downloadJson(`${safe}.samtstyle.json`,JSON.stringify(preset,null,2));
}
function exportBundledPreset(id){
 const preset=FULL_PRESETS[id];if(!preset)return;const palette=PALETTES[preset.paletteId],payload={format:'samt-style-preset',version:1,name:preset.name,layout:preset.layout,appearance:preset.appearance,typography:preset.typography,paletteId:preset.paletteId,palette:{...palette},categoryColors:{},effects:{density:'comfortable',motion:'subtle',glow:preset.appearance==='neon'?'medium':'low'}};
 downloadJson(`${preset.name.replace(/[^a-z0-9_-]+/gi,'-')}.samtstyle.json`,JSON.stringify(payload,null,2));
}
function applyStylePreset(text){
 const preset=parseStylePreset(text),visual={...currentVisual(),layout:preset.layout,typography:preset.typography,paletteId:PALETTES[preset.paletteId]?preset.paletteId:'custom',palette:{...preset.palette},density:preset.effects?.density||'comfortable',motion:preset.effects?.motion||'subtle',glow:preset.effects?.glow||'low',presetName:preset.name||'Imported style'};
 const result=execute(state,{type:'SET_SETTINGS',changes:{appearance:preset.appearance,accent:preset.palette.primary,visual,categoryColors:{...(preset.categoryColors||{})}}},Date.now());
 state=result.state;save();show(`Style preset imported: ${preset.name||'SAMT style'}`);
}
function applyFullPreset(id){
 const preset=FULL_PRESETS[id];if(!preset)return;
 const palette=PALETTES[preset.paletteId],visual={...currentVisual(),layout:preset.layout,typography:preset.typography,paletteId:preset.paletteId,palette:{...palette},presetName:preset.name};
 command('SET_SETTINGS',{changes:{appearance:preset.appearance,accent:palette.primary,visual}});settingsTab='style';render();show(`Preset: ${preset.name}`);
}
function btn(label,action,extra='',style=''){return `<button type="button" class="btn ${style}" data-action="${H(action)}" ${extra}>${H(label)}</button>`;}
function field(label,name,value='',type='text',hint='',options=''){
 const input=type==='select'?`<select name="${H(name)}" id="f_${H(name)}">${options}</select>`:type==='textarea'?`<textarea name="${H(name)}" id="f_${H(name)}">${H(value)}</textarea>`:
   `<input id="f_${H(name)}" name="${H(name)}" type="${H(type)}" value="${H(value)}" ${type==='number'?'step="any"':''}>`;
 return `<div class="field"><label for="f_${H(name)}">${H(label)}</label>${input}${hint?`<small>${H(hint)}</small>`:''}</div>`;
}
function opts(values,selected){return values.map(([value,label])=>`<option value="${H(value)}" ${String(value)===String(selected)?'selected':''}>${H(label)}</option>`).join('');}
function select(label,name,values,selected){return field(label,name,'','select','',opts(values,selected));}
function check(label,name,checked){return `<label class="field check"><input type="checkbox" name="${H(name)}" ${checked?'checked':''}>${H(label)}</label>`;}
function orb(symbol,color){return `<span class="orb" style="--item-color:${H(color||state.settings.accent)}">${H(symbol)}</span>`;}
function actionColour(action){
 const custom=state.settings.categoryColors||{};for(const tagId of action?.tagIds||[]){const tag=state.tags.find(t=>t.id===tagId);if(tag&&custom[tag.categoryId])return custom[tag.categoryId];}
 return state.settings.accent||currentPalette().primary;
}
function empty(label,action,text){return `<div class="empty"><strong>${H(label)}</strong>${H(text||'Start by adding your first item.')}<div class="actions" style="justify-content:center;margin-top:13px">${btn('Add one',action,'','primary')}</div></div>`;}
function status(value){const t=String(value||'OPEN').toUpperCase();const cls=['COMPLETED','REACHED','DONE','ACTIVE'].includes(t)?'good':['MISSED','FAILED'].includes(t)?'bad':'warn';return `<span class="badge ${cls}">${H(title(t))}</span>`;}
function top(){const mode=theme(),modeIcon=mode==='dark'?'☼':mode==='neon'?'◇':'☾';return `<header class="top"><div><div class="eyebrow">${H(new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}))}</div><h1>${H(names[route])}</h1></div><div class="top-actions"><button class="iconbtn" type="button" data-action="theme" title="Change appearance">${modeIcon}</button><button class="iconbtn" type="button" data-action="quick-log" title="Quick log">+</button><div class="avatar">S</div></div></header>`;}
function shell(content){const links=nav.map(([key,icon,label])=>`<button type="button" data-route="${key}" class="${route===key?'active':''}"><span class="ico">${navIcon(icon)}</span><span>${label}</span></button>`).join('');return `<div class="shell"><aside class="side"><div class="brand"><span class="mark">↗</span><span><strong>SAMT</strong><small>سَمْت · Direction</small></span></div><nav class="nav">${links}</nav><div class="side-foot">Your progress, your direction.<br>Saved on this phone.</div></aside><main class="main">${top()}${temporary?'<div class="data-note danger-note">Storage is unavailable. Export a backup before leaving.</div>':''}${content}</main><nav class="bottom" aria-label="Main navigation">${links}</nav></div>${modal?modalHtml():''}${toast?`<div class="toast" role="status">${H(toast.message)}</div>`:''}`;}
function modalHtml(){return `<div class="modal-shade" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="${H(modal.heading)}" data-stop="1"><div class="modal-head"><div><div class="eyebrow">SAMT · ${H(modal.eyebrow||'Build')}</div><h2>${H(modal.heading)}</h2></div><button type="button" class="iconbtn" data-action="close-modal" aria-label="Close">×</button></div><form id="editor" data-form="${H(modal.kind)}">${modal.body}<div class="modal-foot">${btn('Cancel','close-modal') }<button type="submit" class="btn primary">${H(modal.submit||'Save')}</button></div></form></div></div>`;}
function open(kind,heading,body,submit='Save',data={}){modal={kind,heading,body,submit,data};render();}
function render(){const visual=applyVisual(document.documentElement,state.settings,prefersDark());document.querySelector('meta[name=theme-color]')?.setAttribute('content',visual.tokens.bg);window.SamtAndroid?.setSystemBars?.(visual.tokens.bg,visual.appearance==='light');const page=recovery?recoveryPage():route==='home'?homePage():route==='actions'?actionsPage():route==='blocks'?blocksPage():route==='log'?logPage():route==='activity'?activityPage():settingsPage();root.innerHTML=shell(page);}
function recoveryPage(){return `<section class="stack"><div class="card"><h2>Open your SAMT data safely</h2><p>Saved data could not be read: ${H(recovery?.message)}. No data has been overwritten.</p><div class="actions">${btn('Import a backup','import-backup','','primary')}${btn('Start empty','recover-empty')}</div></div></section>`;}
function homeSnapshot(){
 const data=home(state,Date.now()),summary=overview(state),live=['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'];
 const runs=state.runs.filter(x=>live.includes(x.status)),due=data.due.slice(0,6),avoid=data.avoid.slice(0,5);
 const nowText=data.now?data.now.blockSnapshot?.name||data.now.itemSnapshot?.name||'Next up':'Make the first move';
 const completion=runs.length?Math.round(runs.reduce((n,r)=>{const total=r.children?.length||0,done=(r.children||[]).filter(c=>['DONE','EXCUSED','NOT_APPLICABLE'].includes(c.status)).length;return n+(r.completionPercentage??(total?done/total*100:0));},0)/runs.length):0;
 return {data,summary,runs,due,avoid,nowText,completion,day:localKey(Date.now(),state.settings.timezone)};
}
function homeSimple(x){
 return `<div class="home-layout home-simple"><section class="simple-now"><div class="eyebrow">Now</div><h2>${H(x.nowText)}</h2><div class="simple-actions">${btn('Quick log','quick-log','','primary')}${btn('Blocks','go-blocks')}</div></section><div class="simple-stats"><span><strong>${x.summary.logs}</strong> logs</span><span><strong>${x.runs.length}</strong> live</span><span><strong>${x.data.due.length}</strong> due</span></div><section><div class="section"><h2>Due</h2><span class="small muted">${H(x.day)}</span></div><div class="simple-list">${x.due.length?x.due.map(occRow).join(''):empty('All clear','new-list','Nothing scheduled is due.')}</div></section><section><div class="section"><h2>Active work</h2></div><div class="simple-list">${x.runs.length?x.runs.slice(0,7).map(runRow).join(''):'<p class="small muted">No active Runs.</p>'}</div></section></div>`;
}
function homeOrbit(x){
 const degrees=Math.max(0,Math.min(360,x.completion*3.6));
 return `<div class="home-layout home-orbit"><section class="bearing-panel"><div class="orbit-copy"><div class="eyebrow">Your bearing today</div><h2>${H(x.nowText)}</h2><p>${x.data.now?'Keep the current work in view.':'Create an Action or Block to establish today’s bearing.'}</p><div class="actions">${btn('Quick log','quick-log','','primary')}${btn('Explore Blocks','go-blocks')}</div></div><div class="bearing-instrument" style="--bearing:${degrees}deg"><div class="bearing-core"><strong>${x.completion}%</strong><small>bearing</small></div><span class="bearing-dot"></span></div></section><div class="orbit-stats"><div><strong>${x.summary.logs}</strong><small>Logs</small></div><div><strong>${x.runs.length}</strong><small>Live runs</small></div><div><strong>${x.data.due.length}</strong><small>Due</small></div></div><div class="orbit-columns"><section class="orbit-track"><div class="section"><h2>Current track</h2><span class="badge">${x.runs.length}</span></div>${x.runs.length?x.runs.slice(0,6).map(runRow).join(''):empty('No active runs','go-blocks','Start a Routine, Workflow or Project.')}</section><section class="orbit-track"><div class="section"><h2>Approaching</h2><span class="badge">${x.due.length}</span></div>${x.due.length?x.due.map(occRow).join(''):empty('All clear','new-list','Nothing is approaching.')}</section></div></div>`;
}
function homeCommand(x){
 return `<div class="home-layout home-command"><div class="command-strip"><span>SAMT / ${H(x.day)}</span><span>LIVE ${x.runs.length}</span><span>DUE ${x.data.due.length}</span><span>LOGS ${x.summary.logs}</span></div><div class="command-grid"><section class="command-module command-now"><div class="module-label">CURRENT</div><h2>${H(x.nowText)}</h2><div class="module-meter"><span style="width:${x.completion}%"></span></div><small>${x.completion}% active-run completion</small><div class="actions">${btn('LOG','quick-log','','primary')}${btn('BLOCKS','go-blocks')}</div></section><section class="command-module command-metric"><div class="module-label">STATUS</div><div class="command-big">${x.completion}</div><small>BEARING %</small></section><section class="command-module command-metric"><div class="module-label">QUEUE</div><div class="command-big">${x.data.due.length}</div><small>DUE ITEMS</small></section><section class="command-module command-wide"><div class="module-label">ACTIVE RUNS</div>${x.runs.length?x.runs.slice(0,5).map(runRow).join(''):'<p class="small">NO ACTIVE RUNS</p>'}</section><section class="command-module command-wide"><div class="module-label">DUE / OVERDUE</div>${x.due.length?x.due.map(occRow).join(''):'<p class="small">QUEUE CLEAR</p>'}</section></div></div>`;
}
function homeJournal(x){
 const timeline=[...x.due.map(o=>({kind:'due',at:o.dueAt,item:o})),...x.runs.slice(0,4).map(r=>({kind:'run',at:r.startedAt,item:r}))].sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(0,10);
 return `<article class="home-layout home-journal"><header class="journal-cover"><div class="eyebrow">${H(new Date().toLocaleDateString('en-GB',{weekday:'long'}))}</div><h2>${H(new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))}</h2><p>${H(x.nowText)}</p><div class="journal-score"><strong>${x.completion}%</strong><span>today's active bearing</span></div></header><section class="journal-section"><div class="journal-heading">Today</div>${timeline.length?timeline.map(t=>`<div class="journal-entry"><time>${H(new Date(t.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}</time><div>${t.kind==='due'?occRow(t.item):runRow(t.item)}</div></div>`).join(''):empty('An open page','go-blocks','Your scheduled work and active Runs will form today’s page.')}</section><section class="journal-section journal-notes"><div class="journal-heading">At a glance</div><p>${x.summary.logs} factual logs · ${x.runs.length} active Runs · ${x.data.due.length} due items.</p><div class="actions">${btn('Quick log','quick-log','','primary')}${btn('Review Blocks','go-blocks')}</div></section></article>`;
}
function homeMatrix(x){
 const runTiles=x.runs.slice(0,4).map(r=>`<article class="matrix-tile matrix-run"><div class="tile-label">${H(title(r.type))}</div><h2>${H(r.blockSnapshot?.name)}</h2><div class="tile-number">${r.children?.filter(c=>c.status==='DONE').length||0}<small>/${r.children?.length||0}</small></div>${btn('Open','open-run',`data-id="${H(r.id)}"`,'tiny')}</article>`).join('');
 return `<div class="home-layout home-matrix"><div class="matrix-board"><article class="matrix-tile matrix-primary"><div class="tile-label">NOW</div><h2>${H(x.nowText)}</h2><div class="tile-number">${x.completion}<small>%</small></div><div class="actions">${btn('Log','quick-log','','primary')}${btn('Blocks','go-blocks')}</div></article><article class="matrix-tile"><div class="tile-label">DUE</div><div class="tile-number">${x.data.due.length}</div><small>scheduled items</small></article><article class="matrix-tile"><div class="tile-label">LOGS</div><div class="tile-number">${x.summary.logs}</div><small>factual events</small></article>${runTiles||'<article class="matrix-tile matrix-empty"><div class="tile-label">RUNS</div><p>No active Runs.</p></article>'}<article class="matrix-tile matrix-wide"><div class="tile-label">NEXT</div>${x.due.length?x.due.slice(0,4).map(occRow).join(''):'<p class="small">Nothing is due.</p>'}</article></div></div>`;
}
function homePage(){const snapshot=homeSnapshot(),layout=currentVisual().layout;return layout==='simple'?homeSimple(snapshot):layout==='command'?homeCommand(snapshot):layout==='journal'?homeJournal(snapshot):layout==='matrix'?homeMatrix(snapshot):homeOrbit(snapshot);}
function occRow(o){const isTodo=o.entrySnapshot?.kind==='Todo';return `<div class="row">${orb(isTodo?'☑':'◉',isTodo?'var(--accent2)':actionColour(o.itemSnapshot))}<div class="row-main"><strong>${H(o.itemSnapshot?.name||o.entrySnapshot?.name)}</strong><small>${H(date(o.dueAt))} · ${H(state.blocks.find(b=>b.id===o.blockId)?.name||'Action List')}</small></div>${['OPEN','OVERDUE','CARRIED'].includes(o.status)?`${isTodo?btn('Done','todo',`data-id="${H(o.id)}"`,'tiny'):btn('Log','log-occ',`data-id="${H(o.id)}"`,'tiny')}${btn('⋯','occ-options',`data-id="${H(o.id)}"`,'tiny')}`:status(o.status)}</div>`;}
function runRow(r){return `<div class="row">${orb(icons[r.type]||'↻',colors[r.type])}<div class="row-main"><strong>${H(r.blockSnapshot?.name)}</strong><small>${H(title(r.status))} · ${r.children.filter(c=>c.status==='DONE').length}/${r.children.length} done ${r.deadlineAt?'· '+(r.overdueAt?'Overdue since ':'Deadline ')+H(date(r.deadlineAt)):''}</small></div>${btn('Open','open-run',`data-id="${H(r.id)}"`,'tiny')}</div>`;}
function actionsPage(){const active=state.actions.filter(x=>x.status!=='ARCHIVED');return `<div class="stack"><div class="section"><div><h2>Your Actions</h2><span class="small muted">Define once · log everywhere</span></div>${btn('+ Action','new-action','','primary')}</div>${active.length?`<div class="grid">${active.map(a=>`<article class="card" style="border-top:3px solid ${H(a.direction==='Avoid'?'var(--bad)':actionColour(a))}"><div class="card-heading">${orb(a.direction==='Avoid'?'◌':'◉',a.direction==='Avoid'?'var(--bad)':actionColour(a))}${status(a.status)}</div><h2>${H(a.name)}</h2><p class="small">${H(a.description||`${a.completion?.type==='time'?'Time':'Quantity'} · ${a.resultFields.length} result fields`)}</p><div class="actions">${btn('Log','log-action',`data-id="${H(a.id)}"`,'tiny primary')}${btn('History','action-history',`data-id="${H(a.id)}"`,'tiny')}${btn('Edit','edit-action',`data-id="${H(a.id)}"`,'tiny')}${btn('Archive','archive',`data-kind="actions" data-id="${H(a.id)}"`,'tiny')}${btn('Bin','bin',`data-kind="actions" data-id="${H(a.id)}"`,'tiny danger')}</div></article>`).join('')}</div>`:empty('Actions start here','new-action','Define what you do, measure or avoid.')}</div>`;}
function blocksPage(){const type=tab,blocks=state.blocks.filter(b=>b.status!=='ARCHIVED'&&(type==='all'||b.type===type));
 if(detail){const b=state.blocks.find(x=>x.id===detail);return b?blockDetail(b):empty('Block not found','go-blocks');}
 const filters=[['all','All'],...TYPES.map(t=>[t,title(t)])];
 return `<div class="stack"><div class="section"><div><h2>Blocks</h2><span class="small muted">Seven distinct ways to organise your life</span></div>${btn('+ Block','new-block','','primary')}</div><div class="choicebar">${filters.map(([k,label])=>`<button type="button" data-filter="${H(k)}" class="${tab===k?'active':''}">${H(label)}</button>`).join('')}</div>${blocks.length?`<div class="grid">${blocks.map(b=>`<article class="card" style="border-top:3px solid ${H(colors[b.type])}"><div class="card-heading">${orb(icons[b.type],colors[b.type])}<span class="badge">${H(title(b.type))}</span></div><h2>${H(b.name)}</h2><p class="small">${H(b.description||`${(b.relationships||[]).length+(b.entries||[]).length} linked items`)}</p><div class="actions">${btn('Open','block-detail',`data-id="${H(b.id)}"`,'tiny primary')}${btn('Edit','edit-block',`data-id="${H(b.id)}"`,'tiny')}${btn('Archive','archive',`data-kind="blocks" data-id="${H(b.id)}"`,'tiny')}${btn('Bin','bin',`data-kind="blocks" data-id="${H(b.id)}"`,'tiny danger')}</div></article>`).join('')}</div>`:empty('No Blocks here','new-block','Create a Collection, Action List, Routine, Workflow, Project, Cycle or Target.')}</div>`;
}
function blockDetail(b){const runs=state.runs.filter(x=>x.blockId===b.id).slice(-5).reverse(),act=state.activations.find(x=>x.blockId===b.id),periods=state.periods.filter(x=>x.blockId===b.id).slice(-3).reverse(),cycle=state.cycles.find(x=>x.blockId===b.id);
 const lifecycle=b.type==='collection'?'':!act||act.status==='INACTIVE'?btn('Activate','activate',`data-id="${H(b.id)}"`,'primary'):act.status==='PAUSED'?btn('Resume','resume-block',`data-id="${H(b.id)}"`,'primary'):btn('Pause','pause-block',`data-id="${H(b.id)}"`);
 const calendarRoutine=b.type==='routine'&&act?.status==='ACTIVE'&&['daily','weekly'].includes(act.schedule?.period),canRun=['routine','workflow','project'].includes(b.type)&&!calendarRoutine;
 return `<div class="stack"><div class="section"><div>${btn('← Blocks','back-blocks','','tiny')}<div style="height:12px"></div><h2>${H(b.name)}</h2><span class="badge">${H(title(b.type))}</span></div><div class="actions">${btn('Edit','edit-block',`data-id="${H(b.id)}"`)}${lifecycle}</div></div>
 ${b.description?`<div class="data-note">${H(b.description)}</div>`:''}${b.type==='project'?`<div class="card"><div class="card-heading"><h2>Project brief</h2>${b.config?.primary?'<span class="badge">Primary</span>':''}</div><strong>Outcome</strong><p>${H(b.config?.outcome||'No outcome written yet.')}</p>${b.config?.requirements?`<strong>Requirements</strong><p>${H(b.config.requirements)}</p>`:''}<div class="small muted">Planned start: ${H(b.config?.plannedStartAt?date(b.config.plannedStartAt):'Not set')} · Deadline: ${H(b.config?.deadlineAt?date(b.config.deadlineAt):b.config?.deadlineOffsetMinutes?`${Number(b.config.deadlineOffsetMinutes)/1440} days after actual start`:'None')} · ${H(title(b.config?.deadlinePolicy||'continue_overdue'))}</div></div>`:''}<div class="cols"><div class="stack"><div class="card"><div class="card-heading"><h2>${b.type==='action_list'?'Entries':'Relationships'}</h2>${btn(b.type==='action_list'?'+ Entry':'+ Child',b.type==='action_list'?'add-entry':'add-child',`data-id="${H(b.id)}"`,'tiny')}</div>${b.type==='action_list'?(b.entries||[]).map(e=>`<div class="row entry-row">${orb(e.kind==='Todo'?'☑':'◉',colors[b.type])}<div class="row-main"><strong>${H(e.kind==='Todo'?e.name:state.actions.find(x=>x.id===e.refId)?.name||'Missing Action')}</strong><small>${H(e.kind)} · ${H(e.schedule?.mode||'manual')} ${e.schedule?.time?H(e.schedule.time):''} ${e.paused?'· Paused':''}</small><div class="entry-controls">${e.schedule?.mode==='manual'?btn('Start now','start-manual',`data-block="${H(b.id)}" data-id="${H(e.id)}"`,'tiny primary'):''}${btn('Edit','edit-entry',`data-block="${H(b.id)}" data-id="${H(e.id)}"`,'tiny')}${btn(e.paused?'Resume':'Pause','pause-entry',`data-block="${H(b.id)}" data-id="${H(e.id)}"`,'tiny')}${(e.offPeriods||[]).some(p=>p.untilNotified&&!p.notifiedAt)?btn('End Off','end-off',`data-block="${H(b.id)}" data-id="${H(e.id)}"`,'tiny'):btn('Off','off-period',`data-block="${H(b.id)}" data-id="${H(e.id)}"`,'tiny')}</div></div></div>`).join('')||'<p class="small">Add Action or Todo entries to schedule them.</p>':(b.relationships||[]).map(r=>`<div class="row">${orb(r.kind==='Action'?'◉':'▦',colors[b.type])}<div class="row-main"><strong>${H((r.kind==='Action'?state.actions:state.blocks).find(x=>x.id===r.refId)?.name||'Missing')}</strong><small>${r.required?'Required':'Optional'} · ${H(r.kind)}${r.config?.milestone?' · Milestone':''}${r.config?.dependsOn?.length?` · ${r.config.dependsOn.length} prerequisite${r.config.dependsOn.length===1?'':'s'}`:''}${r.config?.time?` · ${H(r.config.time)}${r.config.alarm?' alarm':''}`:''}</small><div class="entry-controls">${btn('Edit','edit-child',`data-block="${H(b.id)}" data-id="${H(r.id)}"`,'tiny')}${btn('Remove','remove-child',`data-block="${H(b.id)}" data-id="${H(r.id)}"`,'tiny danger')}</div></div></div>`).join('')||'<p class="small">Link Actions or Blocks.</p>'}</div>
 ${b.type==='cycle'&&cycle?`<div class="card"><h2>Current cycle</h2><p>Big cycle ${cycle.bigRound||1} · small cycle ${cycle.round} · position ${cycle.index+1} of ${cycle.sequence.length}</p><div class="actions">${btn('Completed','resolve-cycle',`data-id="${H(b.id)}" data-outcome="COMPLETED"`,'primary')}${btn('Missed','resolve-cycle',`data-id="${H(b.id)}" data-outcome="MISSED"`)}</div></div>`:''}
 ${b.type==='target'&&periods.length?`<div class="card"><h2>Target periods</h2>${periods.map(p=>`<div class="row"><div class="row-main"><strong>${H(short(p.start))} – ${H(short(p.end))}</strong><small>${H(String(p.actual))} / ${H(String(p.target))} · ${p.target?Math.round(100*p.actual/p.target):0}%</small></div>${status(p.status)}</div>`).join('')}</div>`:''}</div><div class="stack"><div class="card"><h2>State</h2><div class="row"><div class="row-main"><strong>Definition</strong><small>${H(b.status)}</small></div>${status(b.status)}</div><div class="row"><div class="row-main"><strong>Activation</strong><small>${H(act?.status==='PAUSED'?`Resumes ${date(act.resumeAt)}`:act?.schedule?.period||'Manual')}</small></div>${status(act?.status||'INACTIVE')}</div>${canRun?btn('Run now','run-now',`data-id="${H(b.id)}"`,'primary'):''}</div>${runs.length?`<div class="card"><h2>Recent runs</h2>${runs.map(runRow).join('')}</div>`:''}</div></div></div>`;
}
function logPage(){return `<div class="stack"><div class="section"><h2>Quick log</h2></div><div class="data-note">One real event creates one Action Log. SAMT automatically applies it to every active Run and due Action List occurrence where it belongs.</div>${state.actions.length?`<div class="grid">${state.actions.filter(x=>x.status!=='ARCHIVED').map(a=>`<div class="card"><div class="card-heading">${orb('◉',actionColour(a))}<span class="badge">${H(a.completion.type)}</span></div><h2>${H(a.name)}</h2>${btn('Log this Action','log-action',`data-id="${H(a.id)}"`,'primary')}</div>`).join('')}</div>`:empty('Define an Action first','new-action')}</div>`;}
function activityPage(){const t=activityTab,stats=overview(state);return `<div class="stack"><div class="choicebar">${[['history','History'],['analysis','Analysis'],['reviews','Reviews'],['capacity','Capacity']].map(([key,label])=>`<button type="button" data-activity="${key}" class="${t===key?'active':''}">${label}</button>`).join('')}</div>${t==='history'?`<div class="card"><h2>History</h2>${state.history.length?state.history.slice().reverse().slice(0,120).map(h=>`<div class="row">${orb('•',state.settings.accent)}<div class="row-main"><strong>${H(title(h.event))}</strong><small>${H(date(h.at))} · ${H(h.displayName||state.actions.find(a=>a.id===h.actionId)?.name||state.blocks.find(b=>b.id===h.blockId)?.name||'')}</small></div></div>`).join(''):'<p>No activity yet. Factual logs and outcomes will appear here.</p>'}</div>`:
 t==='analysis'?`<div class="stack"><div class="stat-row">${[['Unique logs',stats.logs],['Unique minutes',stats.uniqueMinutes],['Completed runs',stats.completedRuns]].map(([name,v])=>`<div class="card metric"><div class="stat-number">${v}</div><div class="stat-label">${name}</div></div>`).join('')}</div><div class="card"><h2>Action analysis</h2>${state.actions.map(a=>{const x=actionAnalysis(state,a.id);return `<div class="row">${orb('◉',state.settings.accent)}<div class="row-main"><strong>${H(a.name)}</strong><small>${x.logs} logs · ${x.minutes} minutes · ${x.quantity} quantity</small></div></div>`}).join('')||'<p>Analysis begins when you log an Action.</p>'}</div></div>`:
 t==='reviews'?`<div class="stack"><div class="section"><h2>Reviews</h2>${btn('+ Review','new-review','','primary')}</div>${state.reviews.slice().reverse().map(x=>`<div class="card"><div class="small muted">${H(short(x.at))} · ${H(x.period)}</div><h2>${H(x.highlights||'Reflection')}</h2><p>${H(x.notes)}</p><strong>Next: ${H(x.next)}</strong></div>`).join('')||empty('No reviews yet','new-review')}</div>`:
 `<div class="card"><h2>Capacity</h2><p>Planning guidance only. Your history records what you actually did.</p><div class="stat-number">${H(state.settings.capacityHours)} h</div><div class="stat-label">Hours planned per week</div>${btn('Adjust in Settings','go-settings')}</div>`}</div>`;}
function paletteSwatches(p){return `<span class="swatches"><i style="--sw:${H(p.primary)}"></i><i style="--sw:${H(p.secondary)}"></i><i style="--sw:${H(p.accent)}"></i><i style="--sw:${H(p.neutral)}"></i></span>`;}
function layoutPreview(id){
 if(id==='simple')return `<span class="layout-preview preview-simple"><i class="pv-title"></i><i></i><i></i><i></i><i></i></span>`;
 if(id==='command')return `<span class="layout-preview preview-command"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
 if(id==='journal')return `<span class="layout-preview preview-journal"><b></b><i></i><b></b><i></i><b></b><i></i></span>`;
 if(id==='matrix')return `<span class="layout-preview preview-matrix"><i></i><i></i><i></i><i></i><i></i></span>`;
 return `<span class="layout-preview preview-orbit"><b><em></em></b><i></i><i></i><i></i></span>`;
}
function styleScreenHead(titleText,subtitle){
 return `<div class="style-screen-head">${stylePanel!=='overview'?btn('‹','style-back','','style-back-btn'):''}<div><div class="eyebrow">Visual system</div><h2>${H(titleText)}</h2>${subtitle?`<p>${H(subtitle)}</p>`:''}</div></div>`;
}
function styleValueRow(label,value,action,detail=''){
 return `<button type="button" class="style-value-row" data-action="style-panel" data-id="${H(action)}"><span><strong>${H(label)}</strong>${detail?`<small>${H(detail)}</small>`:''}</span><span class="style-row-value">${H(value)} <b>›</b></span></button>`;
}
function styleOverview(){
 const visual=currentVisual(),palette=visual.palette,customCount=Object.keys(state.settings.categoryColors||{}).length;
 return `<div class="style-studio style-overview stack">
  ${styleScreenHead('Make SAMT yours','Layout, appearance, colour and writing style are independent.')}
  <section class="style-preview-card">
    <div class="style-preview-visual">${layoutPreview(visual.layout)}<div class="preview-palette">${paletteSwatches(palette)}</div></div>
    <div class="style-preview-copy"><div class="eyebrow">Current look</div><h3>${H(title(visual.layout))}</h3><p>${H(title(theme()))} · ${H(PALETTES[visual.paletteId]?.name||visual.palette.name||'Custom')} · ${H(title(visual.typography))}</p></div>
  </section>
  <section class="style-menu card">
   ${styleValueRow('Layout',title(visual.layout),'layout','Five genuinely different structures')}
   ${styleValueRow('Appearance',title(state.settings.appearance||'system'),'appearance','Follow phone, Light, Dark or Neon')}
   ${styleValueRow('Colour palette',PALETTES[visual.paletteId]?.name||visual.palette.name||'Custom','palette','Reusable colour systems')}
   ${styleValueRow('Writing style',title(visual.typography),'typography','Typography independent from layout')}
   ${styleValueRow('Category colours',customCount?`${customCount} custom`:'Automatic','categories','No forced Religion/Health/etc. colours')}
   ${styleValueRow('Effects',`${title(visual.density||'comfortable')} · ${title(visual.motion||'subtle')}`,'effects','Density, motion and preset name')}
  </section>
  <section class="style-menu card">
   ${styleValueRow('Ready presets','5 included','presets','Apply or export complete looks')}
   <div class="style-inline-actions">${btn('Export current','export-style')}${btn('Import preset','import-style')}</div>
  </section>
 </div>`;
}
function styleLayoutPicker(){
 const visual=currentVisual(),cards=LAYOUTS.map(x=>`<button type="button" class="layout-choice layout-choice-large ${visual.layout===x.id?'active':''}" data-action="set-layout" data-id="${H(x.id)}">${layoutPreview(x.id)}<span class="layout-choice-copy"><strong>${H(x.name)}</strong><small>${H(x.description)}</small></span><span class="choice-check">${visual.layout===x.id?'✓':''}</span></button>`).join('');
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Choose layout','These change structure, not merely colour.') }<div class="layout-picker-list">${cards}</div></div>`;
}
function styleAppearancePicker(){
 const selected=state.settings.appearance||'system';
 const items=[['system','Follow phone','Uses the phone appearance and switches automatically.'],['light','Light','Bright surfaces with high-contrast dark text.'],['dark','Dark','Deep surfaces with restrained highlights.'],['neon','Neon','Near-black surfaces, saturated accents and controlled glow.']];
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Appearance','Generated from your current palette.') }<div class="appearance-picker">${items.map(([id,name,desc])=>`<button type="button" class="appearance-choice appearance-${id} ${selected===id?'active':''}" data-action="set-appearance" data-id="${id}"><span class="appearance-demo"><i></i><i></i><b></b></span><span><strong>${name}</strong><small>${desc}</small></span><em>${selected===id?'✓':''}</em></button>`).join('')}</div></div>`;
}
function stylePalettePicker(){
 const visual=currentVisual(),p=visual.palette;
 const palettes=Object.entries(PALETTES).map(([id,palette])=>`<button type="button" class="palette-choice palette-choice-large ${visual.paletteId===id?'active':''}" data-action="set-palette" data-id="${H(id)}">${paletteSwatches(palette)}<span><strong>${H(palette.name)}</strong><small>${H(palette.description)}</small></span><em>${visual.paletteId===id?'✓':''}</em></button>`).join('');
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Colour palette','Choose a preset or tune every role yourself.')}<div class="palette-picker-list">${palettes}</div><form class="card custom-palette-form" data-form="palette-settings"><div class="card-heading"><div><h2>Custom palette</h2><p class="small">Editing creates your own palette. Light, Dark and Neon are derived from these seven roles.</p></div></div><input type="hidden" name="paletteId" value="${H(visual.paletteId)}"><div class="colour-editor">${[['Primary','primary'],['Secondary','secondary'],['Accent','accent'],['Neutral','neutral'],['Success','success'],['Warning','warning'],['Danger','danger']].map(([label,key])=>field(label,key,p[key],'color')).join('')}</div><button class="btn primary" type="submit">Save custom palette</button></form></div>`;
}
function styleTypographyPicker(){
 const visual=currentVisual();
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Writing style','Typography changes character without changing layout.') }<div class="type-picker">${TYPOGRAPHIES.map(x=>`<button type="button" class="type-choice type-${H(x.id)} ${visual.typography===x.id?'active':''}" data-action="set-typography" data-id="${H(x.id)}"><span class="type-sample">Aa</span><span><strong>${H(x.name)}</strong><small>${H(x.description)}</small></span><em>${visual.typography===x.id?'✓':''}</em></button>`).join('')}</div></div>`;
}
function styleCategoryPicker(){
 const visual=currentVisual(),p=visual.palette,categoryColors=state.settings.categoryColors||{};
 const cats=state.categories.map(cat=>{const color=categoryColors[cat.id]||p.primary,use=!!categoryColors[cat.id];return `<div class="category-colour"><label><input type="checkbox" name="catuse_${H(cat.id)}" ${use?'checked':''}> <span>${H(cat.name)}</span></label><input type="color" name="cat_${H(cat.id)}" value="${H(color)}"><small>${use?'Custom colour':'Automatic / neutral'}</small></div>`;}).join('');
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Category colours','Nothing is forced. Assign colours only where you want them.') }<form class="card" data-form="category-colours">${cats||'<p class="small">Create Categories first, then optional colours can be assigned here.</p>'}<div class="style-form-foot"><button class="btn primary" type="submit">Save category colours</button></div></form></div>`;
}
function styleEffectsPicker(){
 const visual=currentVisual();
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Effects & density','Control motion and spacing separately from the visual identity.') }<form class="card" data-form="effects-settings"><div class="form-grid">${select('Density','density',[['compact','Compact'],['comfortable','Comfortable'],['spacious','Spacious']],visual.density||'comfortable')}${select('Motion','motion',[['off','Off'],['subtle','Subtle'],['expressive','Expressive']],visual.motion||'subtle')}</div>${field('Preset name','presetName',visual.presetName||'My SAMT style','text','Used when exporting your current style.')}<button class="btn primary" type="submit">Save effects</button></form></div>`;
}
function stylePresetPicker(){
 const full=Object.entries(FULL_PRESETS).map(([id,preset])=>`<article class="preset-card preset-card-large"><div><strong>${H(preset.name)}</strong><small>${H(title(preset.layout))} · ${H(title(preset.appearance))} · ${H(title(preset.typography))} · ${H(PALETTES[preset.paletteId].name)}</small></div>${paletteSwatches(PALETTES[preset.paletteId])}<div class="actions">${btn('Apply','full-preset',`data-id="${H(id)}"`,'tiny primary')}${btn('Export','export-full-preset',`data-id="${H(id)}"`,'tiny')}</div></article>`).join('');
 return `<div class="style-studio style-subpage stack">${styleScreenHead('Ready presets','Complete combinations you can apply, export and customise.') }<div class="preset-picker-list">${full}</div><div class="style-inline-actions">${btn('Export current','export-style')}${btn('Import preset','import-style')}</div></div>`;
}
function settingsStyle(){
 if(stylePanel==='layout')return styleLayoutPicker();
 if(stylePanel==='appearance')return styleAppearancePicker();
 if(stylePanel==='palette')return stylePalettePicker();
 if(stylePanel==='typography')return styleTypographyPicker();
 if(stylePanel==='categories')return styleCategoryPicker();
 if(stylePanel==='effects')return styleEffectsPicker();
 if(stylePanel==='presets')return stylePresetPicker();
 return styleOverview();
}
function settingsGeneral(){const defaults=state.settings.defaults||{};return `<div class="cols"><div class="card"><h2>Calendar & behaviour</h2><p class="small">Calendar choices control future boundaries without rewriting history.</p><form data-form="settings">${select('Week begins','weekStartsOn',[[1,'Monday'],[0,'Sunday']],state.settings.weekStartsOn)}${field('Timezone','timezone',state.settings.timezone,'text','Daily Runs close at local midnight.')}${field('Planned weekly capacity (hours)','capacityHours',state.settings.capacityHours,'number')}<div class="separator"></div><h3>Default behaviour</h3>${select('New Action List items','actionListUnfinished',[['expire','Become Missed at deadline'],['stay_overdue','Stay overdue'],['carry_forward','Carry forward']],defaults.actionListUnfinished||'expire')}${select('Missed Cycle item','cycleMissed',[['keep_position','Keep it next'],['skip_to_next','Move to next'],['restart','Restart cycle']],defaults.cycleMissed||'keep_position')}<button class="btn primary" type="submit">Save settings</button></form></div><div class="card"><h2>Current calendar</h2><p>New periods use these settings; stored factual timestamps do not move.</p><div class="data-note">Week: ${H(short(periodBounds('weekly',Date.now(),state.settings).start))} to ${H(short(periodBounds('weekly',Date.now(),state.settings).end))}</div></div></div>`;}
function settingsBuild(){return `<div class="stack"><div class="card"><h2>Starter routines</h2><p class="small">Editable starting structures for your prayer, hygiene and nutrition plans.</p><div class="actions">${[['religion','Prayer & religion'],['hygiene','Hygiene'],['nutrition','Nutrition']].map(([key,label])=>btn(label,'starter',`data-id="${key}" ${state.blocks.some(b=>b.templateKey===key)?'disabled':''}`,'tiny')).join('')}</div></div><div class="grid">${[['categories','Categories'],['tags','Tags'],['units','Units']].map(([kind,label])=>`<div class="card"><div class="card-heading"><h2>${label}</h2>${btn('+ Add',`new-${kind}`,'','tiny')}</div>${state[kind].map(x=>`<div class="row"><div class="row-main"><strong>${H(x.name)}</strong><small>${H(x.dimension||x.symbol||x.status||'')}</small></div>${btn('Archive','archive',`data-kind="${kind}" data-id="${H(x.id)}"`,'tiny')}${btn('Bin','bin',`data-kind="${kind}" data-id="${H(x.id)}"`,'tiny danger')}</div>`).join('')||'<p class="small">None yet.</p>'}</div>`).join('')}</div></div>`;}
function definitionRecords(){
 const all=[['categories',state.categories],['tags',state.tags],['units',state.units],['actions',state.actions],['blocks',state.blocks]].flatMap(([kind,items])=>items.map(item=>{
   const impact=definitionImpact(state,kind,item.id),type=kind==='blocks'?`block:${item.type}`:kind;
   const category=kind==='tags'?state.categories.find(c=>c.id===item.categoryId)?.name:'';
   const tags=kind==='actions'?(item.tagIds||[]).map(id=>state.tags.find(t=>t.id===id)?.name||'').join(' '):'';
   const text=[item.name,item.description,item.id,item.symbol,item.dimension,category,tags].filter(Boolean).join(' ').toLowerCase();
   return {kind,item,impact,type,text};
 }));
 const q=dataFilter.query.trim().toLowerCase();
 return all.filter(x=>(!q||x.text.includes(q))&&(dataFilter.type==='all'||x.type===dataFilter.type)&&(dataFilter.status==='all'||x.item.status===dataFilter.status)&&(
   dataFilter.usage==='all'||dataFilter.usage==='unused'&&!x.impact.references.length||dataFilter.usage==='used'&&x.impact.references.length||dataFilter.usage==='has_history'&&x.impact.historyCount||dataFilter.usage==='no_history'&&!x.impact.historyCount));
}
function managerTypeOptions(){return [['all','All definitions'],['categories','Categories'],['tags','Tags'],['units','Units'],['actions','Actions'],...TYPES.map(t=>[`block:${t}`,title(t)])];}
const definitionKindName=kind=>({categories:'Category',tags:'Tag',units:'Unit',actions:'Action',blocks:'Block'}[kind]||title(kind));
function definitionRow(x){const selected=dataSelected.has(x.item.id);return `<label class="row"><input type="checkbox" data-manager-select="${H(x.item.id)}" data-kind="${H(x.kind)}" ${selected?'checked':''}>${orb(x.kind==='blocks'?icons[x.item.type]:'•',x.kind==='blocks'?colors[x.item.type]:state.settings.accent)}<div class="row-main"><strong>${H(x.item.name)}</strong><small>${H(x.kind==='blocks'?title(x.item.type):definitionKindName(x.kind))} · ${H(x.item.status)} · ${x.impact.references.length?`Used by ${x.impact.references.length}`:'Unused'} · ${x.impact.historyCount} historical</small></div></label>`;}
function settingsData(){
 const counts=[['Actions',state.actions.length],['Blocks',state.blocks.length],['Logs',state.actionLogs.length],['Runs',state.runs.length],['Occurrences',state.occurrences.length],['History',state.history.length]],shown=definitionRecords();
 return `<div class="stack"><div class="cols"><div class="card"><h2>Backups</h2><p>Keep a copy before moving phones or uninstalling SAMT. Import is validated before your current data changes.</p><div class="actions">${btn('Export JSON','export-backup','','primary')}${btn('Import file','import-backup')}${btn('Paste JSON','paste-backup')}</div></div><div class="card"><h2>Stored data</h2><div class="pill-row">${counts.map(([name,n])=>`<span class="badge">${name}: ${n}</span>`).join('')}</div><div class="separator"></div><div class="actions">${btn('Create restore point','restore-point')}${btn('Clear tracked data','open-clear-data','','danger')}</div></div></div>
 <div class="card"><div class="card-heading"><div><h2>Definition manager</h2><p class="small">Find unused items, inspect references, then archive or move only safe selections to Bin.</p></div><span class="badge">${dataSelected.size} selected</span></div><form data-form="manager-filter"><div class="form-grid">${field('Search','query',dataFilter.query,'search')}${select('Type','type',managerTypeOptions(),dataFilter.type)}${select('Status','status',[['all','Any status'],['ACTIVE','Active'],['ARCHIVED','Archived']],dataFilter.status)}${select('Usage','usage',[['all','Any usage'],['unused','Unused'],['used','Used somewhere'],['has_history','Has history'],['no_history','No history']],dataFilter.usage)}</div><button class="btn" type="submit">Apply filters</button></form><div class="actions" style="margin:14px 0">${btn('Select shown','manager-select-all')}${btn('Deselect all','manager-clear-selection')}${btn('Archive','manager-bulk','data-op="archive"')}${btn('Unarchive','manager-bulk','data-op="unarchive"')}${btn('Move to Bin','manager-bulk','data-op="bin"','danger')}</div>${shown.slice(0,150).map(definitionRow).join('')||'<p>No definitions match these filters.</p>'}${shown.length>150?`<p class="small">Showing the first 150 of ${shown.length} matches. Narrow the filters to select specific items.</p>`:''}</div>
 <div class="card danger-zone"><h2>Start fresh</h2><p>Clearing everything is not normal cleanup. SAMT creates a restore point first and returns to a valid empty state.</p>${btn('Clear everything','clear-everything','','danger')}</div>
 <div class="card"><h2>Restore points</h2>${state.restorePoints.slice().reverse().map(p=>`<div class="row"><div class="row-main"><strong>${H(p.reason||'Saved point')}</strong><small>${H(date(p.at))} · ${p.state?.actions?.length||0} Actions · ${p.state?.blocks?.length||0} Blocks · ${p.state?.actionLogs?.length||0} Logs</small></div>${btn('Restore','use-restore-point',`data-id="${H(p.id)}"`,'tiny')}</div>`).join('')||'<p>No restore points yet. Save one before a large change.</p>'}</div></div>`;
}
function binHistory(item){const id=item.originalId;if(item.kind==='actions')return state.actionLogs.filter(x=>x.actionId===id).length+state.occurrences.filter(x=>x.itemSnapshot?.id===id).length;if(item.kind==='blocks')return state.runs.filter(x=>x.blockId===id).length+state.periods.filter(x=>x.blockId===id).length+state.occurrences.filter(x=>x.blockId===id).length;return 0;}
function filteredBin(){const q=binFilter.query.trim().toLowerCase();return state.bin.filter(x=>(binFilter.type==='all'||x.kind===binFilter.type)&&(!q||[x.snapshot.name,x.originalId,x.kind].join(' ').toLowerCase().includes(q)));}
function settingsBin(){const shown=filteredBin();return `<div class="card"><div class="card-heading"><div><h2>Recently deleted</h2><p class="small">Restore keeps the same stable ID. Permanent deletion creates a restore point and never erases factual Logs automatically.</p></div><span class="badge">${binSelected.size} selected</span></div><form data-form="bin-filter"><div class="form-grid">${field('Search Bin','query',binFilter.query,'search')}${select('Type','type',[['all','All types'],['categories','Categories'],['tags','Tags'],['units','Units'],['actions','Actions'],['blocks','Blocks']],binFilter.type)}</div><button class="btn" type="submit">Apply filters</button></form><div class="actions" style="margin:14px 0">${btn('Select shown','bin-select-all')}${btn('Deselect all','bin-clear-selection')}${btn('Restore selected','bin-bulk','data-op="restore"')}${btn('Delete selected','bin-bulk','data-op="delete"','danger')}${state.bin.length?btn('Empty Bin','empty-bin','','danger'):''}</div>${shown.map(item=>`<label class="row"><input type="checkbox" data-bin-select="${H(item.id)}" ${binSelected.has(item.id)?'checked':''}><div class="row-main"><strong>${H(item.snapshot.name)}</strong><small>${H(definitionKindName(item.kind))} · deleted ${H(short(item.deletedAt))} · ${binHistory(item)} historical references</small></div></label>`).join('')||'<p>The Bin is empty or no item matches these filters.</p>'}</div>`;}
function settingsApp(){let p=null;if(window.SamtAndroid)try{p=JSON.parse(window.SamtAndroid.permissions());}catch(e){}const version=window.SamtAndroid?.version?.()||'web preview',upcoming=alarmRequests(state,Date.now());
 const permissionView=p?`<div class="pill-row"><span class="badge ${p.notifications&&p.channel?'good':'bad'}">Notifications ${p.notifications&&p.channel?'ready':'need attention'}</span><span class="badge ${p.exact?'good':'warn'}">Exact timing ${p.exact?'ready':'approximate'}</span><span class="badge">${p.scheduled||0} scheduled on phone</span></div>${p.nextAt?`<p class="small">Next Android alarm: ${H(date(p.nextAt))}</p>`:''}`:'<p>Browser preview: Android permission status appears in the installed app.</p>';
 return `<div class="stack"><div class="card"><h2>SAMT for Android</h2><p>Version ${H(version)} · private, local-first data. Alarms are rebuilt from your open scheduled items whenever data changes, the phone restarts, or the app resumes.</p>${permissionView}<div class="actions" style="margin-top:15px">${window.SamtAndroid?`${btn('Notification settings','notification-permission')}${btn('Exact alarm access','alarm-permission')}${btn('Test in 10 seconds','test-alarm','','primary')}`:''}</div></div><div class="card"><div class="card-heading"><h2>Upcoming alarms & reminders</h2><span class="badge">${upcoming.length}</span></div>${upcoming.slice(0,20).map(x=>`<div class="row"><div class="row-main"><strong>${H(x.title)}</strong><small>${H(date(x.at))} · ${H(title(x.kind))}</small></div></div>`).join('')||'<p>No future alarms are configured. Add a time and enable Alarm on an Action List entry or Routine child.</p>'}${upcoming.length>20?`<p class="small">Showing the next 20 of ${upcoming.length}.</p>`:''}</div></div>`;}
function settingsPage(){const tabs=[['style','Style'],['general','General'],['build','Build'],['data','Data & storage'],['bin','Bin'],['app','App']],pages={style:settingsStyle,general:settingsGeneral,build:settingsBuild,data:settingsData,bin:settingsBin,app:settingsApp};return `<div class="stack"><div class="choicebar settings-tabs">${tabs.map(([k,label])=>`<button type="button" data-settings="${k}" class="${settingsTab===k?'active':''}">${label}</button>`).join('')}</div>${pages[settingsTab]()}</div>`;}

function openDefinitionBulk(op){
 const rows=[...dataSelected].map(id=>definitionRecords().find(x=>x.item.id===id)||[['categories',state.categories],['tags',state.tags],['units',state.units],['actions',state.actions],['blocks',state.blocks]].flatMap(([kind,items])=>items.map(item=>({kind,item,impact:definitionImpact(state,kind,item.id)}))).find(x=>x.item.id===id)).filter(Boolean);
 if(!rows.length){show('Select at least one definition.','bad');return;}
 const blocked=op==='bin'?rows.filter(x=>x.impact.references.length):[],history=rows.reduce((n,x)=>n+x.impact.historyCount,0),verb=op==='archive'?'Archive':op==='unarchive'?'Unarchive':'Move to Bin';
 const warnings=blocked.length?`<div class="data-note danger-note"><strong>Cannot move this selection atomically.</strong>${blocked.map(x=>`<div>${H(x.item.name)} — used by ${H(x.impact.references.join(', '))}</div>`).join('')}</div>`:'';
 open('bulk-data',`${verb} ${rows.length} item${rows.length===1?'':'s'}?`,`<p>Definitions affected: <strong>${rows.length}</strong><br>Historical references retained: <strong>${history}</strong><br>Historical Action Logs deleted: <strong>0</strong></p>${warnings}<div class="list-preview">${rows.slice(0,12).map(x=>`<div class="row"><div class="row-main"><strong>${H(x.item.name)}</strong><small>${H(x.kind)} · ${x.impact.references.length} live references · ${x.impact.historyCount} historical</small></div></div>`).join('')}</div>`,blocked.length?'Close':verb,{op,items:rows.map(x=>({kind:x.kind,id:x.item.id})),blocked:blocked.length});
}
function openBinBulk(op,all=false){
 const ids=all?state.bin.map(x=>x.id):[...binSelected],items=ids.map(id=>state.bin.find(x=>x.id===id)).filter(Boolean);
 if(!items.length){show('Select at least one Bin item.','bad');return;}
 const history=items.reduce((n,x)=>n+binHistory(x),0),deleting=op==='delete';
 open('bin-bulk',`${deleting?'Permanently delete':'Restore'} ${items.length} item${items.length===1?'':'s'}?`,`<p>${deleting?'A restore point will be created first. Factual Logs and historical snapshots remain unless separately cleared.':'Each definition returns with its original stable ID.'}</p><div class="pill-row"><span class="badge">${items.length} definitions</span><span class="badge">${history} historical references</span><span class="badge">0 Logs deleted</span></div>${items.slice(0,12).map(x=>`<div class="row"><div class="row-main"><strong>${H(x.snapshot.name)}</strong><small>${H(x.kind)} · ${H(x.originalId)}</small></div></div>`).join('')}`,deleting?'Delete permanently':'Restore',{op,ids:items.map(x=>x.id)});
}
function openClearData(){
 const choices=[['actionLogs','Action Logs'],['runs','Runs'],['occurrences','Occurrences'],['periods','Target / Avoid periods'],['cycles','Cycle runtime'],['reviews','Reviews'],['history','History ledger'],['settings','Settings']];
 open('clear-data','Clear selected tracked data',`<p class="small">Definitions are managed above. Choose factual/runtime collections carefully; SAMT previews counts and creates a restore point before committing.</p><div class="grid compact">${choices.map(([key,label])=>check(label,`clear_${key}`,false)).join('')}</div><div class="form-grid">${select('Date range','dateMode',[['all','All time'],['before','Before date']],'all')}${field('Before','cutoff','','date')}</div>`,'Preview changes');
}

function actionEditor(action=null){draftResults=action?structuredClone(action.resultFields):[];const tags=state.tags.map(tag=>check(tag.name,`tag_${tag.id}`,action?.tagIds?.includes(tag.id))).join(''),avoid=action?.avoid||{};
 open('action',action?'Edit Action':'New Action',`${field('Name','name',action?.name||'')}${field('Description','description',action?.description||'','textarea')}<div class="form-grid">${select('Direction','direction',[['Do','Do'],['Avoid','Avoid / limit']],action?.direction||'Do')}${select('Completion','completion',[['quantity','Quantity'],['time','Time']],action?.completion?.type||'quantity')}</div><div class="form-grid">${field('Quantity target','target',action?.completion?.target??1,'number')}${field('Minimum minutes','minutes',action?.completion?.minimumMinutes??0,'number')}</div><div class="config-panel" data-action-directions="Avoid"><h3>Avoid / limit rule</h3><p class="small">Log only when the unwanted action happens. A period with no violation succeeds automatically.</p><div class="form-grid">${select('Review period','avoidPeriod',[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly']],avoid.period||'daily')}${field('Allowed amount per period','avoidLimit',avoid.limit??0,'number','Use 0 for a strict do-not-do rule.')}</div></div><div class="field"><label>Tags</label><div class="pill-row">${tags||'<span class="small muted">Create Tags in Settings → Build.</span>'}</div></div><div class="separator"></div><div class="card-heading"><h2>Results (${draftResults.length}/10)</h2>${btn('+ Result','add-result','','tiny')}</div><div id="result-list">${resultDraftHtml()}</div>`,action?'Save Action':'Create Action',{id:action?.id});toggleActionFields();}
function resultDraftHtml(){return draftResults.map((r,i)=>`<div class="row"><div class="row-main"><strong>${H(r.label)}</strong><small>${H(title(r.type))} · ${r.required?'Required':'Optional'}${r.allowedValues?.length?` · ${H(r.allowedValues.join(' / '))}`:''}${r.zeroMeansMissed?' · 0 records Missed':''}</small></div>${btn('Remove','remove-result',`data-index="${i}"`,'tiny danger')}</div>`).join('')||'<p class="small">Optional fields let you record scores, measurements and other results on each log.</p>';}
function toggleActionFields(){const form=document.querySelector('form[data-form=action]');if(!form)return;const direction=form.elements.direction.value;for(const panel of form.querySelectorAll('[data-action-directions]'))panel.hidden=!panel.dataset.actionDirections.split(' ').includes(direction);}
function toggleBlockFields(){const form=document.querySelector('form[data-form=block]');if(!form)return;const type=form.elements.type.value;for(const panel of form.querySelectorAll('[data-block-types]'))panel.hidden=!panel.dataset.blockTypes.split(' ').includes(type);}
function blockEditor(block=null,defaultType='routine'){
 const type=block?.type||defaultType,cfg=block?.config||{},conditions=cfg.conditions||[];
 const targetCondition=conditions.find(c=>c.type==='target')||null,resultCondition=conditions.find(c=>c.type==='result')||null;
 const targetOptions=[['','No Target condition'],...state.blocks.filter(b=>b.type==='target'&&b.status!=='ARCHIVED').map(b=>[b.id,b.name])];
 const resultOptions=[['','No Result condition'],...state.actions.flatMap(a=>(a.resultFields||[]).filter(r=>['percentage','score','measurement'].includes(r.type)).map(r=>[`${a.id}|${r.id}`,`${a.name} · ${r.label}`]))];
 const targetResults=state.actions.flatMap(a=>(a.resultFields||[]).filter(r=>['percentage','score','measurement'].includes(r.type)).map(r=>({actionId:a.id,resultId:r.id,label:`${a.name} · ${r.label}`})));
 const selectedTargetResults=cfg.resultRefs?.length?cfg.resultRefs:(cfg.resultId?[{actionId:null,resultId:cfg.resultId}]:[]);
 const resultChoice=resultCondition?`${resultCondition.actionId}|${resultCondition.resultId}`:'';
 const typeField=block?`<input type="hidden" name="type" value="${H(type)}"><div class="data-note"><strong>${H(title(type))}</strong> · A Block keeps its type after creation so existing Runs and history remain valid.</div>`:select('Block type','type',TYPES.map(t=>[t,title(t)]),type);
 const completion=`<div data-block-types="routine workflow" class="config-panel"><h3>Completion</h3><div class="form-grid">${select('Completion rule','completionMode',[['required_only','Required items'],['count','Minimum child count'],['percentage','Percentage of children'],['manual','Manual finish'],['open_ended','Open-ended']],cfg.completionMode||'required_only')}${field('Count or percentage','completionValue',cfg.completionValue??1,'number')}</div>${select('After minimum','afterMinimum',[['auto_finish','Finish automatically'],['allow_extra','Let me keep going']],cfg.afterMinimum||'auto_finish')}</div>`;
 const target=`<div data-block-types="target" class="config-panel"><h3>Target period</h3><div class="form-grid">${select('Period','targetPeriod',[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly'],['all_time','All time']],cfg.period||'weekly')}${select('Measure','metric',[['count','Log count'],['minutes','Minutes'],['quantity','Quantity'],['result','Result value']],cfg.metric||'count')}</div>${field('Target amount','target',cfg.target??1,'number')}<div class="field"><label>Numeric Results to total</label><div class="pill-row">${targetResults.map(r=>check(r.label,`target_result_${r.actionId}|${r.resultId}`,selectedTargetResults.some(x=>(!x.actionId||x.actionId===r.actionId)&&x.resultId===r.resultId))).join('')||'<small>Create a numeric Action Result first.</small>'}</div><small>Used only when Measure is Result value. Multiple selected Results are summed once per factual Log.</small></div></div>`;
 const routine=`<div data-block-types="routine" class="config-panel"><h3>Automatic calendar</h3>${select('Fresh Run','routinePeriod',[['manual','Only when I start it'],['daily','Every local day'],['weekly','Every local week']],cfg.period||'manual')}<small>Daily and weekly Runs close automatically. Unfinished required work is saved as Missed.</small></div>`;
 const cycle=`<div data-block-types="cycle" class="config-panel"><h3>Cycle movement</h3><div class="form-grid">${select('If the current item is missed','missedPolicy',[['keep_position','Keep it next'],['skip_to_next','Move to next'],['restart','Restart cycle']],cfg.missedPolicy||'keep_position')}${field('Small cycles in one big cycle','smallCyclesPerBig',cfg.smallCyclesPerBig||1,'number')}</div></div>`;
 const project=`<div data-block-types="project" class="config-panel"><h3>Project outcome</h3>${field('Outcome','projectOutcome',cfg.outcome||'','textarea','The finite result this Project exists to achieve.')}${field('Requirements / success notes','projectRequirements',cfg.requirements||'','textarea')}<div class="form-grid">${field('Planned start','plannedStartAt',cfg.plannedStartAt?inputDateTime(cfg.plannedStartAt):'','datetime-local')}${select('Deadline','projectDeadlineMode',[['none','No deadline'],['absolute','Specific date/time'],['relative','Relative to actual start']],cfg.deadlineAt?'absolute':cfg.deadlineOffsetMinutes?'relative':'none')}</div><div class="form-grid">${field('Specific deadline','projectDeadlineAt',cfg.deadlineAt?inputDateTime(cfg.deadlineAt):'','datetime-local')}${field('Relative deadline (days)','projectDeadlineDays',cfg.deadlineOffsetMinutes?Number(cfg.deadlineOffsetMinutes)/1440:'','number')}</div>${select('At the deadline','deadlinePolicy',[['continue_overdue','Continue overdue'],['expire_unfinished','Expire unfinished']],cfg.deadlinePolicy||'continue_overdue')}<div class="separator"></div><h3>Completion conditions</h3><p class="small">Required work and milestones remain mandatory. Extra conditions can be combined with ALL or ANY.</p><div class="form-grid">${select('Base condition','projectCompletionMode',[['required_only','All required children'],['count','Minimum completed child count'],['percentage','Percentage of children'],['manual','Manual']],cfg.completionMode||'required_only')}${field('Count or percentage','projectCompletionValue',cfg.completionValue??1,'number')}${select('Combine conditions','projectConditionMode',[['all','ALL conditions'],['any','ANY condition']],cfg.conditionMode||'all')}${select('Target condition','projectTargetCondition',targetOptions,targetCondition?.targetBlockId||'')}</div><div class="form-grid">${select('Result condition','projectResultCondition',resultOptions,resultChoice)}${select('Result comparison','projectResultOperator',[['>=','≥'],['>','>'],['<=','≤'],['<','<'],['==','='],['!=','≠']],resultCondition?.operator||'>=')}${field('Result threshold','projectResultValue',resultCondition?.value??'','number')}${select('Result aggregation','projectResultAggregate',[['latest','Latest'],['average','Average'],['sum','Sum'],['min','Minimum'],['max','Maximum']],resultCondition?.aggregate||'latest')}</div>${select('When conditions are met','finishBehavior',[['ready_to_finish','Ready to finish'],['auto_finish','Finish automatically']],cfg.finishBehavior||'ready_to_finish')}${check('Show as my primary Project on Today','primary',!!cfg.primary)}</div>`;
 const notes=`<div data-block-types="collection action_list" class="data-note"><span data-block-types="collection">Collections organise and open their children; they do not create Runs.</span><span data-block-types="action_list">Action Lists stay open and generate independent scheduled Occurrences.</span></div>`;
 open('block',block?'Edit Block':'New Block',`${field('Name','name',block?.name||'')}${field('Description','description',block?.description||'','textarea')}${typeField}${routine}${completion}${target}${cycle}${project}${notes}`,block?'Save Block':'Create Block',{id:block?.id});
 toggleBlockFields();
}
function childEditor(block,relationship=null){
 const config=relationship?.config||{},target=relationship?(relationship.kind==='Action'?state.actions:state.blocks).find(x=>x.id===relationship.refId):null,completion=config.completion||null;
 const choice=relationship?`<div class="data-note">Editing ${H(target?.name||'linked child')}. The definition always changes future Runs. Active Project Runs change only when explicitly selected below.</div>`:`${select('Child kind','kind',[['Action','Action'],['Block','Block']],'Action')}${select('Action','actionId',state.actions.map(a=>[a.id,a.name]),state.actions[0]?.id)}${select('Block','blockId',state.blocks.filter(b=>b.id!==block.id).map(b=>[b.id,b.name]),'')}`;
 const liveProjectRuns=block.type==='project'?state.runs.filter(r=>r.blockId===block.id&&['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'].includes(r.status)):[];
 const scopeControls=block.type==='project'&&liveProjectRuns.length?`<div class="separator"></div><h3>Active Run scope</h3>${select('Apply this scope edit to','scopeMode',[['future_only','Future Runs Only'],['selected_runs','Selected unfinished Runs too']],'future_only')}<div class="pill-row">${liveProjectRuns.map(r=>check(`${date(r.startedAt)} · ${title(r.status)}`,`scope_run_${r.id}`,false)).join('')}</div><small>Selected Runs receive a Scope Change Event. Their Run Start Snapshot stays unchanged.</small></div>`:'';
 const projectExtras=block.type==='project'?`<div class="separator"></div><h3>Project timing & dependency</h3>${check('Milestone checkpoint','milestone',!!config.milestone)}<div class="form-grid">${field('Available from','availableAt',config.availableAt?inputDateTime(config.availableAt):'','datetime-local')}${field('Or available after start (days)','availableDays',config.availableOffsetMinutes?Number(config.availableOffsetMinutes)/1440:'','number')}${field('Child deadline','childDeadlineAt',config.deadlineAt?inputDateTime(config.deadlineAt):'','datetime-local')}${field('Or deadline after start (days)','childDeadlineDays',config.deadlineOffsetMinutes?Number(config.deadlineOffsetMinutes)/1440:'','number')}</div><div class="field"><label>Prerequisites</label><div class="pill-row">${(block.relationships||[]).filter(r=>r.id!==relationship?.id).map(r=>{const item=(r.kind==='Action'?state.actions:state.blocks).find(x=>x.id===r.refId);return check(item?.name||'Missing',`dep_${r.id}`,(config.dependsOn||[]).includes(r.id));}).join('')||'<span class="small muted">No other Project children yet.</span>'}</div><small>LOCKED means configured prerequisites are unresolved. BLOCKED is a separate runtime state for an external obstacle.</small></div>`:'';
 open('child',relationship?'Edit linked child':'Link a child',`${choice}<div class="form-grid">${check('Required for completion','required',relationship?.required!==false)}${field('Cycle weight','weight',relationship?.weight||1,'number')}</div><div class="separator"></div><h3>Completion in this Block</h3><p class="small">Leave this as the Action default, or override how much work is required only in this relationship.</p><div class="form-grid">${select('Completion rule','childCompletion',[['default','Use Action default'],['quantity','Quantity override'],['time','Time override']],completion?.type||'default')}${field('Quantity target','childTarget',completion?.target??1,'number')}${field('Minimum minutes','childMinutes',completion?.minimumMinutes??1,'number')}</div>${projectExtras}${scopeControls}<div class="separator"></div><h3>Optional reminder</h3><div class="form-grid">${field('Time in your SAMT timezone','time',config.time||'','time')}${select('Weekly day','weekday',[['','Run day / not set'],[0,'Sunday'],[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday']],config.weekday??'')}</div>${field('Reminders (minutes before, comma separated)','reminders',(config.reminderMinutes||[]).join(','))}${check('Alarm at that time','alarm',!!config.alarm)}<p class="small">For a weekly Routine, choose a weekday. Android schedules these locally and refreshes them when a new Run starts.</p>`,relationship?'Save child':'Add child',{blockId:block.id,relationshipId:relationship?.id});
}
function entryEditor(block,entry=null){const options=state.actions.map(a=>[a.id,a.name]),s=entry?.schedule||{};
 open('entry',entry?'Edit entry':'Action List entry',`
 ${select('Entry type','kind',[['Todo','Todo'],['Action','Action']],entry?.kind|| (options.length?'Action':'Todo'))}
 ${field('Todo title','name',entry?.name||'')}${select('Linked Action','refId',[['','Choose an Action'],...options],entry?.refId||'')}
 ${select('Schedule','mode',[['manual','Manual'],['once','Once'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly'],['interval','Interval'],['specific_dates','Specific dates']],s.mode||'daily')}
 <div class="form-grid">${field('Time (local)','time',s.time||'09:00','time')}${field('Once at','at',s.at?inputDateTime(s.at):'', 'datetime-local')}
 ${field('First active date','activeFrom',entry?.activeFrom?inputDateTime(entry.activeFrom):'', 'datetime-local')}${field('Last active date','activeUntil',entry?.activeUntil?inputDateTime(entry.activeUntil):'', 'datetime-local')}</div>
 <div class="form-grid">${field('Weekdays (0=Sun, comma separated)','weekdays',(s.weekdays||[1,2,3,4,5]).join(','))}${field('Specific dates (YYYY-MM-DD, comma separated)','dates',(s.dates||[]).join(','))}
 ${field('Every N days or weeks','every',s.every||1,'number')}${select('Interval unit','unit',[['days','Days'],['weeks','Weeks']],s.unit||'days')}
 ${field('Day of month (1–31)','day',s.day||1,'number')}${field('Month of year (1–12)','month',s.month||1,'number')}</div>
 <div class="form-grid">${field('Deadline after due (minutes)','deadlineMinutes',entry?.deadlineMinutes??'')}${field('Repeat until','repeatEnd',entry?.repeatEnd?inputDateTime(entry.repeatEnd):'','datetime-local')}</div>
 <div class="form-grid">${select('Unfinished item','unfinished',[['expire','Become missed'],['stay_overdue','Stay overdue'],['carry_forward','Carry forward']],entry?.unfinished||state.settings.defaults?.actionListUnfinished||'expire')}${select('Overlap','overlap',[['keep_each','Keep each occurrence'],['block_next','Wait for current item']],entry?.overlap||'keep_each')}</div>
 ${field('Reminders (minutes before, comma separated)','reminders',(entry?.reminderMinutes||[15]).join(','))}${check('Alarm at due time','alarm',entry?.alarm||false)}`,
 entry?'Save entry':'Add entry',{blockId:block.id,entryId:entry?.id});}
function logEditor(action,contextId=null){const resultFields=(action.resultFields||[]).map(f=>f.type==='choice'?select(f.label,`result_${f.id}`,[['','Choose'],...(f.options||[]).map(o=>[o.id,o.label])],''):
 field(`${f.label}${f.required?' *':''}`,`result_${f.id}`,'',f.type==='text'?'text':'number',f.allowedValues?.length?`Allowed: ${f.allowedValues.join(', ')}`:'')).join('');
 const contexts=state.runs.filter(r=>r.status==='IN_PROGRESS'||(r.type==='project'&&['READY_TO_FINISH','OVERDUE'].includes(r.status))).flatMap(r=>r.children.filter(c=>c.refId===action.id&&c.status==='OPEN'&&c.inScope!==false).map(c=>[c.id,`${r.blockSnapshot.name} · ${c.definitionSnapshot?.name||action.name}`]));
 const occ=state.occurrences.filter(o=>o.itemSnapshot?.id===action.id&&['OPEN','OVERDUE','CARRIED'].includes(o.status)).map(o=>[o.id,`${state.blocks.find(b=>b.id===o.blockId)?.name||'List'} · ${date(o.dueAt)}`]);
 const matches=[...contexts,...occ].filter(([key])=>{const occurrence=state.occurrences.find(o=>o.id===key);return key===contextId||!occurrence||occurrence.dueAt<=new Date().toISOString();});
 const outcome=action.direction==='Avoid'?'':select('Outcome','outcome',[['DONE','Completed / done'],['MISSED','Missed']],'DONE');
 open('log',`Log ${action.name}`,`${field('When it happened','occurredAt',inputDateTime(),'datetime-local')}${outcome}<div class="form-grid">${field('Quantity','quantity',action.completion?.type==='quantity'?1:0,'number')}${field('Minutes','durationMinutes',action.completion?.type==='time'?1:0,'number')}</div>${resultFields}${field('Notes','notes','','textarea')}<div class="field"><label>Counts automatically in</label><div class="pill-row">${matches.map(([,label])=>`<span class="badge">${H(label)}</span>`).join('')||'<small>No open context currently needs this Action; the factual Log still stays in History and Analysis.</small>'}</div><small>One real event stays one Log even when several active Blocks use it.</small></div>`,'Save log',{actionId:action.id,contextId});}
function runModal(r){
 const project=r.type==='project',cfg=r.blockSnapshot?.config||{};
 const head=project?`<div class="data-note"><strong>Outcome:</strong> ${H(cfg.outcome||'Not written')}<br><span class="small">Planned ${H(r.plannedStartAt?date(r.plannedStartAt):'not set')} · Actual ${H(date(r.actualStartAt||r.startedAt))}${r.deadlineAt?` · Deadline ${H(date(r.deadlineAt))}`:''}${r.overdueAt?' · OVERDUE':''}</span></div>`:'';
 const conditions=project&&(r.conditionResults||[]).length?`<div class="card"><h3>Completion evaluator</h3>${r.conditionResults.map(c=>{const actual=c.actual&&typeof c.actual==='object'?`${c.actual.resolved}/${c.actual.total}`:c.actual==null?'—':String(Math.round(Number(c.actual)*100)/100);return `<div class="row"><div class="row-main"><strong>${H(title(c.type))}</strong><small>${H(actual)}${c.target!=null?` / ${H(c.target)}`:''}${c.error?` · ${H(c.error)}`:''}</small></div>${status(c.reached?'REACHED':'WAITING')}</div>`}).join('')}</div>`:'';
 const children=r.children.filter(c=>c.inScope!==false&&c.status!=='REMOVED').map(c=>`<div class="row">${orb(c.status==='DONE'?'✓':c.status==='BLOCKED'?'!':c.status==='LOCKED'?'🔒':c.status==='EXCUSED'?'≈':c.status==='NOT_APPLICABLE'?'∅':'○',colors[r.type])}<div class="row-main"><strong>${H(c.definitionSnapshot?.name)}${c.milestone?' · Milestone':''}</strong><small>${c.required?'Required':'Optional'} · ${H(title(c.status))}${c.progress?` · ${H(c.progress)} recorded`:''}${c.availableAt?` · Available ${H(date(c.availableAt))}`:''}${c.dueAt?` · ${c.overdue?'Overdue ':'Due '}${H(date(c.dueAt))}`:''}${c.blockedReason?` · ${H(c.blockedReason)}`:''}</small></div>${c.status==='OPEN'&&c.kind==='Action'&&c.definitionSnapshot?.direction!=='Avoid'?btn('Log','log-run-child',`data-id="${H(c.id)}" data-action-id="${H(c.refId)}"`,'tiny primary'):''}${c.status==='OPEN'&&c.kind==='Block'&&c.definitionSnapshot?.type!=='routine'?btn('Done','done-child',`data-run="${H(r.id)}" data-id="${H(c.id)}"`,'tiny'):''}${project&&c.status==='OPEN'?btn('Resolve','project-child-options',`data-run="${H(r.id)}" data-id="${H(c.id)}"`,'tiny'):''}${project&&c.status==='OPEN'?btn('Block','block-project-child',`data-run="${H(r.id)}" data-id="${H(c.id)}"`,'tiny'):''}${project&&c.status==='BLOCKED'?btn('Unblock','unblock-project-child',`data-run="${H(r.id)}" data-id="${H(c.id)}"`,'tiny primary'):''}</div>`).join('');
 const hasManual=cfg.completionMode==='manual'||(cfg.conditions||[]).some(c=>c.type==='manual');
 const controls=project&&['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'].includes(r.status)?`<div class="actions">${(r.status==='READY_TO_FINISH'||hasManual)?btn('Finish Project','finish-project',`data-id="${H(r.id)}"`,'primary'):''}${r.status==='BLOCKED'?btn('Unblock Project','unblock-project',`data-id="${H(r.id)}"`):r.status!=='PAUSED'?btn('Mark blocked','block-project',`data-id="${H(r.id)}"`):''}${btn('Cancel Project','cancel-project',`data-id="${H(r.id)}"`,'danger')}</div>`:'';
 open('run',r.blockSnapshot.name,`<p>${H(title(r.status))} · Started ${H(date(r.startedAt))}</p>${head}${conditions}${children}${controls}`,'Close',{runId:r.id});
}
function modalFor(action,node){const id=node.dataset.id,blockId=node.dataset.block;switch(action){
 case 'new-action':actionEditor();break;case 'edit-action':actionEditor(state.actions.find(x=>x.id===id));break;
 case 'new-block':blockEditor();break;case 'new-list':blockEditor(null,'action_list');break;case 'edit-block':blockEditor(state.blocks.find(x=>x.id===id));break;
 case 'add-entry':entryEditor(state.blocks.find(x=>x.id===id));break;
 case 'edit-entry':{const block=state.blocks.find(x=>x.id===blockId);entryEditor(block,block?.entries.find(e=>e.id===id));break;}
 case 'add-child':childEditor(state.blocks.find(b=>b.id===id));break;
 case 'edit-child':{const block=state.blocks.find(b=>b.id===blockId);childEditor(block,block?.relationships.find(r=>r.id===id));break;}
 case 'activate':open('activation','Activate Block',`${select('Schedule','period',[['manual','Manual'],['daily','Every local day'],['weekly','Every local week']],state.blocks.find(b=>b.id===id)?.config?.period||'manual')}<p class="small">Daily and weekly Routine Runs close at the calendar boundary and generate the next Run automatically.</p>`,'Activate',{blockId:id});break;
 case 'pause-block':open('pause-block','Pause Block',`${field('Resume on','resumeAt',inputDateTime(Date.now()+86400000),'datetime-local')}<p class="small">The current Run keeps its progress. Calendar Routine days while paused will not be counted as missed.</p>`,'Pause',{blockId:id});break;
 case 'log-action':logEditor(state.actions.find(x=>x.id===id));break;
 case 'log-occ':{const occ=state.occurrences.find(x=>x.id===id);logEditor(state.actions.find(a=>a.id===occ.itemSnapshot.id),occ.id);break;}
 case 'quick-log':if(state.actions.length)navigate('log');else actionEditor();break;
 case 'new-review':open('review','Write a review',`${select('Period','period',[['day','Daily'],['week','Weekly'],['month','Monthly']],'week')}${field('Highlights','highlights')}${field('Reflection','notes','','textarea')}${field('What next?','next','','textarea')}`,'Save review');break;
 case 'off-period':open('off','Set an Off Period',`${field('Start','start',inputDateTime(),'datetime-local')}${field('End (leave blank for until notified)','end','','datetime-local')}${check('Until notified / ended by me','untilNotified',false)}`,'Set Off',{blockId,entryId:id});break;
 case 'occ-options':open('occ-options','Occurrence options',`<p>Skip resolves only this occurrence. Snooze moves its alarm while the item remains open.</p><div class="actions">${btn('Snooze 10 minutes','snooze-occ',`data-id="${H(id)}"`)}${btn('Skip this one','skip-occ',`data-id="${H(id)}"`,'danger')}</div>`,'Close',{occurrenceId:id});break;
 case 'new-categories':open('category','New Category',`${field('Name','name')}${field('Colour','color','#1d9a84','color')}`,'Create');break;
 case 'new-tags':open('tag','New Tag',`${field('Name','name')}${select('Category','categoryId',state.categories.map(c=>[c.id,c.name]),state.categories[0]?.id)}`,'Create');break;
 case 'new-units':open('unit','New Unit',`${field('Name','name')}${field('Symbol','symbol')}${field('Dimension (e.g. mass, distance)','dimension')}`,'Create');break;
 case 'add-result':if(draftResults.length<10){actionReturn={values:formObject(document.querySelector('#editor')),id:modal.data.id,results:structuredClone(draftResults)};open('result','Add a Result field',`${field('Label','label')}${select('Type','type',RESULT_TYPES.map(t=>[t,title(t)]),'score')}${check('Required','required',false)}<div class="form-grid">${field('Minimum','minimum',0,'number')}${field('Maximum','maximum',10,'number')}</div>${field('Allowed numeric values','allowedValues','','text','Optional, comma separated — for example 0, 3, 10')}${check('A score of 0 records this Action as Missed','zeroMeansMissed',false)}${select('Unit','unitId',[['','None'],...state.units.map(u=>[u.id,`${u.name} (${u.symbol||''})`])],'')}${field('Choice options (comma separated)','options','')}`,'Add field');}break;
 default:break;
}}
function formObject(form){const data=new FormData(form),obj=Object.fromEntries(data.entries());for(const el of form.querySelectorAll('input[type=checkbox]'))obj[el.name]=el.checked;return obj;}
function submit(form){const m=modal;if(!m)return;const d=formObject(form);let value;switch(m.kind){
 case 'occ-options':case 'run':modal=null;render();return;
 case 'block-project-child':value=command('BLOCK_PROJECT_CHILD',{runId:m.data.runId,childId:m.data.childId,reason:d.reason,expectedUnblockAt:d.expectedUnblockAt?new Date(d.expectedUnblockAt).toISOString():null});break;
 case 'block-project':value=command('BLOCK_PROJECT',{runId:m.data.runId,reason:d.reason,expectedUnblockAt:d.expectedUnblockAt?new Date(d.expectedUnblockAt).toISOString():null});break;
 case 'cancel-project':value=command('CANCEL_RUN',{runId:m.data.runId,reason:d.reason});break;
 case 'bulk-data':{
   if(m.data.blocked){modal=null;render();return;}
   const commands={archive:'BULK_ARCHIVE',unarchive:'BULK_UNARCHIVE',bin:'BULK_BIN'};
   value=command(commands[m.data.op],{items:m.data.items});if(value)dataSelected.clear();break;
 }
 case 'bin-bulk':value=command(m.data.op==='restore'?'BULK_RESTORE':'BULK_PERMANENT_DELETE',{binIds:m.data.ids});if(value)binSelected.clear();break;
 case 'clear-data':{
   const categories=['actionLogs','runs','occurrences','periods','cycles','reviews','history','settings'].filter(key=>d[`clear_${key}`]);
   if(!categories.length)throw new Error('Choose at least one data category.');
   if(d.dateMode==='before'&&!d.cutoff)throw new Error('Choose a cutoff date.');
   const options={categories,dateMode:d.dateMode,cutoff:d.dateMode==='before'?new Date(`${d.cutoff}T00:00:00`).toISOString():null};options.impact=dataClearImpact(state,options);
   const labels={actionLogs:'Action Logs',runs:'Runs',occurrences:'Occurrences',periods:'Periods',cycles:'Cycles',reviews:'Reviews',history:'History records',settings:'Settings'};
   open('clear-confirm',`Clear ${options.impact.total} record${options.impact.total===1?'':'s'}?`,`<p>A full restore point will be created before this atomic change.</p>${Object.entries(options.impact.counts).map(([key,count])=>`<div class="row"><div class="row-main"><strong>${H(labels[key]||key)}</strong><small>${count} matching record${count===1?'':'s'}</small></div></div>`).join('')}${options.impact.affectsAnalysis?'<div class="data-note danger-note">Analysis and current Target totals will be recalculated from the remaining Logs.</div>':''}`,'Clear selected data',{options});return;
 }
 case 'clear-confirm':value=command('CLEAR_DATA',m.data.options);break;
 case 'category':value=command('ADD_DEFINITION',{kind:'categories',data:{name:d.name.trim(),color:d.color}});break;
 case 'tag':value=command('ADD_DEFINITION',{kind:'tags',data:{name:d.name.trim(),categoryId:d.categoryId}});break;
 case 'unit':value=command('ADD_DEFINITION',{kind:'units',data:{name:d.name.trim(),symbol:d.symbol,dimension:d.dimension}});break;
 case 'result':{
   if(!d.label.trim())throw new Error('Give this Result a name.');
   const allowedValues=csvNumbers(d.allowedValues);
   const field={id:`result_${crypto.randomUUID()}`,label:d.label.trim(),type:d.type,required:!!d.required,minimum:d.minimum===''?null:Number(d.minimum),maximum:d.maximum===''?null:Number(d.maximum),allowedValues:allowedValues.length?allowedValues:null,zeroMeansMissed:!!d.zeroMeansMissed,unitId:d.unitId||null,options:d.options?d.options.split(',').map(label=>({id:`option_${crypto.randomUUID()}`,label:label.trim()})).filter(x=>x.label):[]};
   const draft=actionReturn;draft.results.push(field);actionEditor(draft.id?state.actions.find(x=>x.id===draft.id):null);draftResults=draft.results;
   const restored=document.querySelector('#editor');for(const [name,v] of Object.entries(draft.values)){const el=restored.elements.namedItem(name);if(el){if(el.type==='checkbox')el.checked=!!v;else el.value=v;}}
   document.querySelector('#result-list').innerHTML=resultDraftHtml();actionReturn=null;return;
 }
 case 'action':{
   const tags=Object.entries(d).filter(([k,v])=>k.startsWith('tag_')&&v).map(([k])=>k.slice(4));
   const data={name:d.name.trim(),description:d.description.trim(),direction:d.direction,completion:d.completion==='time'?{type:'time',minimumMinutes:Number(d.minutes)||0}:{type:'quantity',target:Number(d.target)||1},avoid:d.direction==='Avoid'?{period:d.avoidPeriod||'daily',limit:Math.max(0,Number(d.avoidLimit)||0),mode:'binary_limit'}:null,resultFields:structuredClone(draftResults),tagIds:tags};
   value=m.data.id?command('EDIT_DEFINITION',{kind:'actions',id:m.data.id,changes:data}):command('ADD_DEFINITION',{kind:'actions',data});break;
 }
 case 'block':{
   const previous=m.data.id?(state.blocks.find(b=>b.id===m.data.id)?.config||{}):{},config={...previous};
   if(d.type==='routine')config.period=d.routinePeriod;
   if(['routine','workflow'].includes(d.type)){config.completionMode=d.completionMode;config.completionValue=Number(d.completionValue)||0;config.afterMinimum=d.afterMinimum;}
   if(d.type==='target'){
     const resultRefs=Object.entries(d).filter(([key,value])=>key.startsWith('target_result_')&&value).map(([key])=>{const [actionId,resultId]=key.slice(14).split('|');return {actionId,resultId};});
     if(d.metric==='result'&&!resultRefs.length)throw new Error('Choose at least one numeric Result to total.');
     config.period=d.targetPeriod;config.metric=d.metric;config.resultRefs=d.metric==='result'?resultRefs:[];config.resultId=resultRefs[0]?.resultId||null;config.target=Number(d.target)||0;
   }
   if(d.type==='cycle'){config.missedPolicy=d.missedPolicy;config.smallCyclesPerBig=Math.max(1,Number(d.smallCyclesPerBig)||1);}
   if(d.type==='project'){
     config.outcome=d.projectOutcome.trim();config.requirements=d.projectRequirements.trim();config.primary=!!d.primary;
     config.plannedStartAt=d.plannedStartAt?new Date(d.plannedStartAt).toISOString():null;
     config.deadlineMode=d.projectDeadlineMode;config.deadlinePolicy=d.deadlinePolicy;config.finishBehavior=d.finishBehavior;
     config.deadlineAt=d.projectDeadlineMode==='absolute'&&d.projectDeadlineAt?new Date(d.projectDeadlineAt).toISOString():null;
     config.deadlineOffsetMinutes=d.projectDeadlineMode==='relative'&&Number(d.projectDeadlineDays)>0?Number(d.projectDeadlineDays)*1440:null;
     config.completionMode=d.projectCompletionMode;config.completionValue=Number(d.projectCompletionValue)||0;config.conditionMode=d.projectConditionMode;
     const projectConditions=[];
     if(d.projectCompletionMode==='required_only')projectConditions.push({id:'base-required',type:'required'});
     if(d.projectCompletionMode==='count')projectConditions.push({id:'base-count',type:'count',value:Number(d.projectCompletionValue)||0});
     if(d.projectCompletionMode==='percentage')projectConditions.push({id:'base-percentage',type:'percentage',value:Number(d.projectCompletionValue)||0});
     if(d.projectCompletionMode==='manual')projectConditions.push({id:'base-manual',type:'manual'});
     if(d.projectTargetCondition)projectConditions.push({id:'target-condition',type:'target',targetBlockId:d.projectTargetCondition});
     if(d.projectResultCondition){const [actionId,resultId]=d.projectResultCondition.split('|');projectConditions.push({id:'result-condition',type:'result',actionId,resultId,operator:d.projectResultOperator,value:Number(d.projectResultValue),aggregate:d.projectResultAggregate});}
     config.conditions=projectConditions;
   }
   const data={name:d.name.trim(),description:d.description.trim(),type:d.type,config};
   value=m.data.id?command('EDIT_DEFINITION',{kind:'blocks',id:m.data.id,changes:data}):command('ADD_DEFINITION',{kind:'blocks',data});break;
 }
 case 'child':{
   const parent=state.blocks.find(b=>b.id===m.data.blockId);
   const config={time:d.time||null,weekday:d.weekday===''?null:Number(d.weekday),reminderMinutes:csvNumbers(d.reminders).filter(x=>x>=0),alarm:!!d.alarm};
   if(d.childCompletion==='quantity')config.completion={type:'quantity',target:Number(d.childTarget)};
   if(d.childCompletion==='time')config.completion={type:'time',minimumMinutes:Number(d.childMinutes)};
   if(parent?.type==='project'){
     config.milestone=!!d.milestone;config.availableAt=d.availableAt?new Date(d.availableAt).toISOString():null;config.availableOffsetMinutes=Number(d.availableDays)>0?Number(d.availableDays)*1440:null;
     config.deadlineAt=d.childDeadlineAt?new Date(d.childDeadlineAt).toISOString():null;config.deadlineOffsetMinutes=Number(d.childDeadlineDays)>0?Number(d.childDeadlineDays)*1440:null;
     config.dependsOn=Object.entries(d).filter(([k,v])=>k.startsWith('dep_')&&v).map(([k])=>k.slice(4));
   }
   const scopeRunIds=parent?.type==='project'&&d.scopeMode==='selected_runs'?Object.entries(d).filter(([k,v])=>k.startsWith('scope_run_')&&v).map(([k])=>k.slice(10)):[];
   value=m.data.relationshipId?command('EDIT_RELATIONSHIP',{blockId:m.data.blockId,relationshipId:m.data.relationshipId,required:!!d.required,weight:Number(d.weight)||1,config,scopeRunIds}):command('ADD_RELATIONSHIP',{blockId:m.data.blockId,kind:d.kind,refId:d.kind==='Action'?d.actionId:d.blockId,required:!!d.required,weight:Number(d.weight)||1,config,scopeRunIds});break;
 }
 case 'remove-project-child':{
   const scopeRunIds=d.scopeMode==='selected_runs'?Object.entries(d).filter(([k,v])=>k.startsWith('scope_run_')&&v).map(([k])=>k.slice(10)):[];
   value=command('REMOVE_RELATIONSHIP',{blockId:m.data.blockId,relationshipId:m.data.relationshipId,scopeRunIds});break;
 }
 case 'entry':{
   const schedule={mode:d.mode,time:d.time,at:d.at?new Date(d.at).toISOString():null,weekdays:d.weekdays.split(',').map(Number),dates:d.dates.split(',').map(x=>x.trim()).filter(Boolean),every:Number(d.every)||1,unit:d.unit,day:Number(d.day)||1,month:Number(d.month)||1};
   const changes={kind:d.kind,refId:d.kind==='Action'?d.refId:null,name:d.name.trim(),schedule,activeFrom:d.activeFrom?new Date(d.activeFrom).toISOString():null,activeUntil:d.activeUntil?new Date(d.activeUntil).toISOString():null,deadlineMinutes:d.deadlineMinutes===''?null:Number(d.deadlineMinutes),repeatEnd:d.repeatEnd?new Date(d.repeatEnd).toISOString():null,unfinished:d.unfinished,overlap:d.overlap,reminderMinutes:d.reminders.split(',').map(Number).filter(x=>x>=0),alarm:!!d.alarm};
   value=m.data.entryId?command('EDIT_ENTRY',{blockId:m.data.blockId,entryId:m.data.entryId,changes}):command('ADD_ENTRY',{blockId:m.data.blockId,...changes});break;
 }
 case 'activation':value=command('ACTIVATE',{blockId:m.data.blockId,schedule:{period:d.period}});break;
 case 'pause-block':value=command('PAUSE_BLOCK',{blockId:m.data.blockId,resumeAt:new Date(d.resumeAt).toISOString()});break;
 case 'log':{
   const results={};for(const [k,v] of Object.entries(d))if(k.startsWith('result_'))results[k.slice(7)]=v;
   const action=state.actions.find(a=>a.id===m.data.actionId),zeroMissed=action?.resultFields?.some(f=>f.zeroMeansMissed&&Number(results[f.id])===0);
   value=command('LOG_ACTION',{actionId:m.data.actionId,occurredAt:d.occurredAt?new Date(d.occurredAt).toISOString():null,outcome:zeroMissed?'MISSED':(d.outcome||'DONE'),quantity:Number(d.quantity)||0,durationMinutes:Number(d.durationMinutes)||0,results,contexts:m.data.contextId?[m.data.contextId]:[],notes:d.notes});break;
 }
 case 'review':value=command('ADD_REVIEW',{period:d.period,highlights:d.highlights,notes:d.notes,next:d.next});break;
 case 'off':value=command('OFF_PERIOD',{blockId:m.data.blockId,entryId:m.data.entryId,start:new Date(d.start).toISOString(),end:d.end?new Date(d.end).toISOString():null,untilNotified:!!d.untilNotified});break;
 case 'paste-backup':applyImport(d.json);modal=null;render();return;
 default:return;
 }
 if(value){modal=null;render();show('Saved.');}
}
function exportFile(){const content=backup(state,Date.now()),name=`SAMT-backup-${localKey(Date.now(),state.settings.timezone)}.json`;downloadJson(name,content);}
function snapshotForRestore(s){return structuredClone({...s,restorePoints:[]});}
function restorePoint(reason){return {id:`restore_${crypto.randomUUID()}`,at:new Date().toISOString(),reason,state:snapshotForRestore(state)};}
function applyImport(text){const incoming=importBackup(text);incoming.restorePoints.push(restorePoint('before import'));validate(incoming);state=incoming;recovery=null;save();show('Backup imported.');}
function applyIncoming(text){const parsed=JSON.parse(text);if(parsed?.format==='samt-style-preset'){applyStylePreset(parsed);return;}applyImport(text);}
async function importFile(file){try{applyIncoming(await file.text());}catch(e){show(`Import cancelled: ${e.message}`,'bad');}}
window.SamtReceiveImport=text=>{try{applyIncoming(text);}catch(e){show(`Import cancelled: ${e.message}`,'bad');}};
const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.addEventListener('change',()=>{if(input.files?.[0])importFile(input.files[0]);input.value='';});document.body.appendChild(input);
root.addEventListener('click',e=>{const node=e.target.closest('[data-route],[data-action],[data-filter],[data-activity],[data-settings]');if(!node)return;
 if(node.dataset.stop)return;if(node.dataset.route){navigate(node.dataset.route);return;}
 if(node.dataset.filter){tab=node.dataset.filter;render();return;}if(node.dataset.activity){activityTab=node.dataset.activity;render();return;}if(node.dataset.settings){settingsTab=node.dataset.settings;if(settingsTab==='style')stylePanel='overview';render();return;}
 const a=node.dataset.action,id=node.dataset.id;
 if(a==='close-modal'){closeEditorModal();return;}if(a==='theme'){const modes=['system','light','dark','neon'],current=state.settings.appearance||'system',next=modes[(modes.indexOf(current)+1)%modes.length];command('SET_SETTINGS',{changes:{appearance:next}});show(`Appearance: ${title(next)}`);return;}
 if(a==='style-panel'){stylePanel=id;settingsTab='style';render();return;}
 if(a==='style-back'){stylePanel='overview';settingsTab='style';render();return;}
 if(a==='set-layout'){const visual={...currentVisual(),layout:id};command('SET_SETTINGS',{changes:{visual}});settingsTab='style';stylePanel='layout';return;}
 if(a==='set-appearance'){command('SET_SETTINGS',{changes:{appearance:id}});settingsTab='style';stylePanel='appearance';return;}
 if(a==='set-typography'){const visual={...currentVisual(),typography:id};command('SET_SETTINGS',{changes:{visual}});settingsTab='style';stylePanel='typography';return;}
 if(a==='set-palette'){const palette=PALETTES[id];if(palette){const visual={...currentVisual(),paletteId:id,palette:{...palette}};command('SET_SETTINGS',{changes:{visual,accent:palette.primary}});settingsTab='style';stylePanel='palette';}return;}
 if(a==='full-preset'){applyFullPreset(id);return;}
 if(a==='export-full-preset'){exportBundledPreset(id);show('Ready preset exported.');return;}
 if(a==='export-style'){exportStylePreset();show('Style preset ready to save.');return;}
 if(a==='import-style'){if(window.SamtAndroid)window.SamtAndroid.importFile();else input.click();return;}
 if(a==='go-blocks'||a==='back-blocks'){navigate('blocks');return;}if(a==='go-actions'){navigate('actions');return;}if(a==='go-settings'){settingsTab='style';stylePanel='overview';navigate('settings');return;}
 if(a==='block-detail'){navigate('blocks',id);return;}if(a==='todo'){command('COMPLETE_TODO',{occurrenceId:id});return;}
 if(a==='resume-block'){command('RESUME_BLOCK',{blockId:id});return;}
 if(a==='starter'){if(command('ADD_STARTER',{which:id})){navigate('blocks');show('Routines added and started.');}return;}
 if(a==='start-manual'){command('START_MANUAL_OCCURRENCE',{blockId:node.dataset.block,entryId:id});return;}
 if(a==='pause-entry'){
   const entry=state.blocks.find(b=>b.id===node.dataset.block)?.entries.find(e=>e.id===id);
   if(entry)command('PAUSE_ENTRY',{blockId:node.dataset.block,entryId:id,paused:!entry.paused});return;
 }
 if(a==='end-off'){
   const entry=state.blocks.find(b=>b.id===node.dataset.block)?.entries.find(e=>e.id===id);
   const off=entry?.offPeriods?.find(p=>p.untilNotified&&!p.notifiedAt);
   if(off)command('STOP_OFF_PERIOD',{blockId:node.dataset.block,entryId:id,offId:off.id});return;
 }
 if(a==='snooze-occ'){command('SNOOZE',{occurrenceId:id,minutes:10});modal=null;render();return;}if(a==='skip-occ'){if(confirm('Skip this occurrence only?')){command('SKIP_OCCURRENCE',{occurrenceId:id});modal=null;render();}return;}
 if(a==='resolve-cycle'){command('RESOLVE_CYCLE',{blockId:id,outcome:node.dataset.outcome});return;}if(a==='run-now'){command('RUN_NOW',{blockId:id});return;}
 if(a==='open-run'){const r=state.runs.find(x=>x.id===id);if(!r)return;runModal(r);return;}
 if(a==='log-run-child'){logEditor(state.actions.find(x=>x.id===node.dataset.actionId),id);return;}
 if(a==='done-child'){command('RESOLVE_CHILD',{runId:node.dataset.run,childId:id,status:'DONE'});modal=null;return;}
 if(a==='project-child-options'){open('run','Resolve Project child',`<p class="small">These outcomes stay distinct in History.</p><div class="actions">${btn('Skip','resolve-project-child',`data-run="${H(node.dataset.run)}" data-id="${H(id)}" data-status="SKIPPED"`)}${btn('Excuse','resolve-project-child',`data-run="${H(node.dataset.run)}" data-id="${H(id)}" data-status="EXCUSED"`)}${btn('Not applicable','resolve-project-child',`data-run="${H(node.dataset.run)}" data-id="${H(id)}" data-status="NOT_APPLICABLE"`)}</div>`,'Close');return;}
 if(a==='resolve-project-child'){command('RESOLVE_CHILD',{runId:node.dataset.run,childId:id,status:node.dataset.status});modal=null;render();return;}
 if(a==='block-project-child'){open('block-project-child','Block Project child',`${field('Reason','reason','','textarea')}${field('Expected unblock','expectedUnblockAt','','datetime-local')}`,'Mark blocked',{runId:node.dataset.run,childId:id});return;}
 if(a==='unblock-project-child'){command('UNBLOCK_PROJECT_CHILD',{runId:node.dataset.run,childId:id});modal=null;render();return;}
 if(a==='block-project'){open('block-project','Mark Project blocked',`${field('Reason','reason','','textarea')}${field('Expected unblock','expectedUnblockAt','','datetime-local')}`,'Mark blocked',{runId:id});return;}
 if(a==='unblock-project'){command('UNBLOCK_PROJECT',{runId:id});modal=null;render();return;}
 if(a==='finish-project'){command('FINISH_RUN',{runId:id});modal=null;render();return;}
 if(a==='cancel-project'){open('cancel-project','Cancel Project',`${field('Reason','reason','','textarea')}`,'Cancel Project',{runId:id});return;}
 if(a==='action-history'){activityTab='analysis';navigate('activity');return;}
 if(a==='manager-select-all'){for(const item of definitionRecords().slice(0,150))dataSelected.add(item.item.id);render();return;}
 if(a==='manager-clear-selection'){dataSelected.clear();render();return;}
 if(a==='manager-bulk'){openDefinitionBulk(node.dataset.op);return;}
 if(a==='open-clear-data'){openClearData();return;}
 if(a==='bin-select-all'){for(const item of filteredBin())binSelected.add(item.id);render();return;}
 if(a==='bin-clear-selection'){binSelected.clear();render();return;}
 if(a==='bin-bulk'){openBinBulk(node.dataset.op);return;}
 if(a==='remove-child'){const block=state.blocks.find(b=>b.id===node.dataset.block);if(block?.type==='project'){const runs=state.runs.filter(r=>r.blockId===block.id&&['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'].includes(r.status));const choices=runs.length?`${select('Apply removal to','scopeMode',[['future_only','Future Runs Only'],['selected_runs','Selected unfinished Runs too']],'future_only')}<div class="pill-row">${runs.map(r=>check(`${date(r.startedAt)} · ${title(r.status)}`,`scope_run_${r.id}`,false)).join('')}</div><small>Selected active Runs record a Scope Change Event. Their Run Start Snapshot stays unchanged.</small>`:'<p>This changes future Runs only. There are no unfinished Project Runs.</p>';open('remove-project-child','Remove Project child',choices,'Remove',{blockId:block.id,relationshipId:id});}else if(confirm('Remove this link from future Runs? Existing Run snapshots and History stay unchanged.'))command('REMOVE_RELATIONSHIP',{blockId:node.dataset.block,relationshipId:id});return;}
 if(a==='archive'){if(confirm('Archive this definition? Its history will remain.'))command('ARCHIVE',{kind:node.dataset.kind,id});return;}
 if(a==='bin'){if(confirm('Move this definition to Bin? SAMT will check active dependencies.'))command('BIN',{kind:node.dataset.kind,id});return;}
 if(a==='restore'){command('RESTORE',{binId:id});return;}if(a==='permanent-delete'){if(confirm('Permanently delete this Bin item?'))command('PERMANENT_DELETE',{binId:id});return;}
 if(a==='export-backup'){exportFile();return;}if(a==='import-backup'){if(window.SamtAndroid)window.SamtAndroid.importFile();else input.click();return;}
 if(a==='paste-backup'){open('paste-backup','Paste a SAMT backup',`${field('Backup JSON','json','','textarea','The backup is checked completely before your current data changes.')}`,'Validate & import');return;}
 if(a==='restore-point'){state.restorePoints.push(restorePoint('manual'));save();show('Restore point saved.');return;}
 if(a==='use-restore-point'){
   const point=state.restorePoints.find(p=>p.id===id);if(!point||!confirm(`Restore SAMT as it was on ${date(point.at)}? Current data will be kept as a restore point.`))return;
   try{const candidate=structuredClone(point.state);validate(candidate);const prior=restorePoint('before restore');candidate.restorePoints=[...state.restorePoints,prior];state=candidate;save();show('Restore point applied.');}catch(error){show(error.message,'bad');}return;
 }
 if(a==='empty-bin'){openBinBulk('delete',true);return;}
 if(a==='clear-everything'){if(confirm('Clear all SAMT data on this phone? Export a backup first if you need this history later.')&&confirm('This removes Actions, Blocks, Logs and History. Continue?')){const prior=restorePoint('before clearing everything');state=emptyState();state.restorePoints.push(prior);save();show('SAMT is empty. Your previous data is available as a restore point.');}return;}
 if(a==='recover-empty'){if(confirm('Replace unreadable stored data with a new empty SAMT?')){state=emptyState();recovery=null;save();}return;}
 if(a==='alarm-permission'){window.SamtAndroid?.requestAlarmPermission();return;}
 if(a==='notification-permission'){window.SamtAndroid?.requestNotifications();return;}
 if(a==='test-alarm'){const ok=window.SamtAndroid?.testAlarm?.();show(ok?'Test alarm scheduled for 10 seconds from now. Keep the phone sound on.':'Allow notifications first, then try the test again.',ok?'good':'bad');return;}
 if(a==='remove-result'){draftResults.splice(Number(node.dataset.index),1);document.querySelector('#result-list').innerHTML=resultDraftHtml();return;}
 if(a)modalFor(a,node);
});
root.addEventListener('submit',e=>{e.preventDefault();const form=e.target,d=formObject(form);
 if(form.dataset.form==='palette-settings'){
   const selected=PALETTES[d.paletteId],palette={name:'Custom',description:'User-edited SAMT palette.',primary:d.primary,secondary:d.secondary,accent:d.accent,neutral:d.neutral,success:d.success,warning:d.warning,danger:d.danger};
   const same=selected&&['primary','secondary','accent','neutral','success','warning','danger'].every(k=>String(selected[k]).toLowerCase()===String(palette[k]).toLowerCase());
   const visual={...currentVisual(),paletteId:same?d.paletteId:'custom',palette:same?{...selected}:palette};
   command('SET_SETTINGS',{changes:{accent:visual.palette.primary,visual}});settingsTab='style';stylePanel='palette';show('Palette saved.');return;
 }
 if(form.dataset.form==='category-colours'){
   const categoryColors={};for(const cat of state.categories)if(d[`catuse_${cat.id}`])categoryColors[cat.id]=d[`cat_${cat.id}`];
   command('SET_SETTINGS',{changes:{categoryColors}});settingsTab='style';stylePanel='categories';show('Category colours saved.');return;
 }
 if(form.dataset.form==='effects-settings'){
   const visual={...currentVisual(),density:d.density,motion:d.motion,presetName:d.presetName.trim()||'My SAMT style'};
   command('SET_SETTINGS',{changes:{visual}});settingsTab='style';stylePanel='effects';show('Effects saved.');return;
 }
 if(form.dataset.form==='settings'){command('SET_SETTINGS',{changes:{timezone:d.timezone,weekStartsOn:Number(d.weekStartsOn),capacityHours:Number(d.capacityHours),defaults:{...(state.settings.defaults||{}),actionListUnfinished:d.actionListUnfinished,cycleMissed:d.cycleMissed}}});show('Settings saved.');return;}
 if(form.dataset.form==='manager-filter'){dataFilter={query:d.query,type:d.type,status:d.status,usage:d.usage};render();return;}if(form.dataset.form==='bin-filter'){binFilter={query:d.query,type:d.type};render();return;}try{submit(form);}catch(error){show(error.message,'bad');}});
root.addEventListener('change',e=>{if(e.target.matches('form[data-form=block] [name=type]'))toggleBlockFields();if(e.target.matches('form[data-form=action] [name=direction]'))toggleActionFields();if(e.target.matches('[data-manager-select]')){const id=e.target.dataset.managerSelect;e.target.checked?dataSelected.add(id):dataSelected.delete(id);render();}if(e.target.matches('[data-bin-select]')){const id=e.target.dataset.binSelect;e.target.checked?binSelected.add(id):binSelected.delete(id);render();}});
root.addEventListener('click',e=>{if(e.target.classList.contains('modal-shade'))closeEditorModal();});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>render());
if(!recovery){state=reconcile(state,Date.now());persist();syncNative();}
window.SamtResume=()=>{try{const raw=window.SamtAndroid?.loadState?.();if(raw){const onPhone=JSON.parse(raw);validate(onPhone);state=reconcile(onPhone,Date.now());persist();syncNative();render();}}catch(e){show(`Phone data could not be refreshed: ${e.message}`,'bad');}};
window.SamtFileError=message=>show(message,'bad');
setInterval(()=>{if(!recovery){try{refreshFromPhone();const next=reconcile(state,Date.now());if(JSON.stringify(next)!==JSON.stringify(state)){state=next;save();}}catch(e){show(e.message,'bad');}}},60000);
render();
