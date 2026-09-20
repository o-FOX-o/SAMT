/* SAMT's domain rules have no DOM, Android or storage dependency. All commands
   receive an explicit instant so tests and background reconciliation agree. */
export const TYPES = ['collection','action_list','routine','workflow','project','cycle','target'];
export const RESULT_TYPES = ['percentage','score','measurement','text','choice'];
export const SCHEDULE_MODES = ['manual','once','daily','weekly','monthly','yearly','interval','specific_dates'];
export const VERSION = 3;
const copy = value => structuredClone(value);
const id = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const iso = instant => new Date(instant).toISOString();
const dtfCache = new Map();
function formatter(zone) {
  if (!dtfCache.has(zone)) dtfCache.set(zone, new Intl.DateTimeFormat('en-GB', {
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }));
  return dtfCache.get(zone);
}
export function localParts(instant, zone='Europe/London') {
  const p={}; for (const item of formatter(zone).formatToParts(new Date(instant)))
    if(item.type!=='literal') p[item.type]=Number(item.value);
  return p;
}
export function localKey(instant,zone='Europe/London') {
  const p=localParts(instant,zone); return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
function dayShift(key,amount) {
  const d=new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount);
  return d.toISOString().slice(0,10);
}
function zoned(key,time='00:00',zone='Europe/London') {
  const [y,m,d]=key.split('-').map(Number),[h,min]=time.split(':').map(Number);
  const wall=Date.UTC(y,m-1,d,h||0,min||0), asUtc=p=>Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  let guess=wall;
  for(let i=0;i<5;i++) {
    const offset=asUtc(localParts(guess,zone))-guess;
    const next=wall-offset; if(next===guess) break; guess=next;
  }
  return new Date(guess).toISOString();
}
function weekStart(key,first=1) {
  const weekday=new Date(`${key}T12:00:00Z`).getUTCDay();
  return dayShift(key,-((weekday-first+7)%7));
}
export function periodBounds(kind,instant,settings={}) {
  const zone=settings.timezone||'Europe/London',first=settings.weekStartsOn??1;
  const today=localKey(instant,zone); let start=today,end=dayShift(today,1);
  if(kind==='weekly') {start=weekStart(today,first);end=dayShift(start,7);}
  if(kind==='monthly') {start=today.slice(0,7)+'-01';const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);end=d.toISOString().slice(0,10);}
  if(kind==='yearly') {start=today.slice(0,4)+'-01-01';end=String(Number(today.slice(0,4))+1)+'-01-01';}
  return {key:start,start:zoned(start,'00:00',zone),end:zoned(end,'00:00',zone),timezone:zone};
}
export function emptyState() {
  return {format:'samt',schemaVersion:VERSION,settings:{timezone:'Europe/London',weekStartsOn:1,appearance:'system',accent:'#147d86',categoryColors:{},capacityHours:40,defaults:{cycleMissed:'keep_position'}},
    categories:[],tags:[],units:[],actions:[],blocks:[],activations:[],runs:[],occurrences:[],periods:[],cycles:[],actionLogs:[],reviews:[],history:[],bin:[],restorePoints:[],meta:{createdAt:null,updatedAt:null}};
}
const arrays=['categories','tags','units','actions','blocks','activations','runs','occurrences','periods','cycles','actionLogs','reviews','history','bin','restorePoints'];
function byId(s,kind,ref) {return s[kind].find(x=>x.id===ref);}
function references(s,blockId,targetId,visited=new Set()) {
  if(blockId===targetId)return true;
  if(visited.has(blockId))return false;
  visited.add(blockId);
  return (byId(s,'blocks',blockId)?.relationships||[]).some(r=>r.kind==='Block'&&references(s,r.refId,targetId,visited));
}
export function validate(s) {
  insist(s&&typeof s==='object'&&s.schemaVersion===VERSION,'Unsupported SAMT schema.');
  for(const key of arrays) insist(Array.isArray(s[key]),`Invalid ${key} collection.`);
  const ids=new Set();
  for(const key of arrays)for(const record of s[key]) {insist(record&&typeof record.id==='string'&&record.id,'A record has no stable ID.');insist(!ids.has(record.id),`Duplicate ID ${record.id}.`);ids.add(record.id);}
  insist(s.settings&&typeof s.settings.timezone==='string','Timezone setting is required.');
  try{formatter(s.settings.timezone).format(new Date());}catch(e){throw new Error('Unknown timezone.');}
  for(const key of ['categories','tags','units','actions','blocks'])for(const record of s[key])insist(typeof record.name==='string'&&record.name.trim(),'Every definition needs a name.');
  for(const tag of s.tags) insist(!!byId(s,'categories',tag.categoryId),'A Tag has no Category.');
  for(const a of s.actions) {
    insist(['Do','Avoid'].includes(a.direction),'Action direction must be Do or Avoid.');
    insist(['quantity','time'].includes(a.completion?.type),'Action completion must be quantity or time.');
    insist(Array.isArray(a.resultFields)&&a.resultFields.length<=10,'Actions allow up to ten Results.');
    for(const r of a.resultFields){insist(RESULT_TYPES.includes(r.type),'Invalid Result type.');insist(typeof r.label==='string'&&r.label.trim(),'A Result needs a name.');}
    for(const tagId of a.tagIds||[])insist(!!byId(s,'tags',tagId),'Action references missing Tag.');
  }
  for(const block of s.blocks) {
    insist(TYPES.includes(block.type),'Invalid Block type.');
    insist(Array.isArray(block.relationships),'Block has no relationship list.');
    for(const r of block.relationships) {
      insist(r.kind==='Action'||r.kind==='Block','Invalid child kind.');
      insist(!!byId(s,r.kind==='Action'?'actions':'blocks',r.refId),'Missing child definition.');
      if(r.kind==='Block')insist(!references(s,r.refId,block.id),'Circular Block reference.');
    }
    if(block.type==='action_list')for(const e of block.entries||[]) {
      insist(e.kind==='Action'||e.kind==='Todo','Invalid Action List entry.');
      if(e.kind==='Action')insist(!!byId(s,'actions',e.refId),'Action entry has no Action.');
      else insist(typeof e.name==='string'&&e.name.trim(),'Todo needs a title.');
      insist(SCHEDULE_MODES.includes(e.schedule?.mode||'manual'),'Unknown schedule mode.');
      if(e.schedule?.mode==='once')insist(Number.isFinite(Date.parse(e.schedule.at)),'Once schedule needs a date and time.');
      if(e.schedule?.mode==='monthly'||e.schedule?.mode==='yearly')insist(Number(e.schedule.day||1)>=1&&Number(e.schedule.day||1)<=31,'Day of month must be 1–31.');
      if(e.schedule?.mode==='yearly')insist(Number(e.schedule.month||1)>=1&&Number(e.schedule.month||1)<=12,'Month must be 1–12.');
      insist((e.reminderMinutes||[]).every(n=>Number.isFinite(Number(n))&&Number(n)>=0),'Reminder minutes must be positive.');
      const off=e.offPeriods||[];
      for(let i=0;i<off.length;i++)for(let j=0;j<i;j++)
        insist(!(off[i].start<(off[j].end||'9999')&&off[j].start<(off[i].end||'9999')),'Off Periods cannot overlap.');
    }
  }
  return true;
}
function record(s,event,data,at) {s.history.push({id:id('history'),event,at:iso(at),...data});}
function names(snapshot,s) {return snapshot?.name||byId(s,'actions',snapshot?.id)?.name||byId(s,'blocks',snapshot?.id)?.name||'Deleted item';}
function resultValue(field,raw,s) {
  if(raw===undefined||raw===null||raw==='') {insist(!field.required,`${field.label} is required.`);return null;}
  if(['percentage','score'].includes(field.type)) {
    const n=Number(raw);insist(Number.isFinite(n),'Result must be numeric.');
    if(field.type==='percentage')insist(n>=0&&n<=100,'Percentage must be 0–100.');
    if(field.minimum!=null)insist(n>=field.minimum,'Result below its minimum.');
    if(field.maximum!=null)insist(n<=field.maximum,'Result above its maximum.');
    return n;
  }
  if(field.type==='measurement') {
    const v=typeof raw==='object'?raw:{value:raw,unitId:field.unitId};
    insist(Number.isFinite(Number(v.value)),'Measurement must be numeric.');
    insist(!field.unitId||v.unitId===field.unitId||byId(s,'units',v.unitId)?.dimension===byId(s,'units',field.unitId)?.dimension,'Incompatible unit.');
    return {value:Number(v.value),unitId:v.unitId||field.unitId||null};
  }
  if(field.type==='choice') {
    const values=Array.isArray(raw)?raw:[raw];
    insist(field.multiple||values.length===1,'Choose one option.');
    insist(values.every(x=>(field.options||[]).some(o=>o.id===x)),'Unknown choice option.');
    if(field.minSelections)insist(values.length>=field.minSelections,'Too few options selected.');
    return field.multiple?values:values[0];
  }
  return String(raw);
}
function createRun(s,block,at,bounds=null) {
  const r={id:id('run'),blockId:block.id,type:block.type,startedAt:bounds?.start||iso(at),deadlineAt:bounds?.end||null,
    status:'IN_PROGRESS',blockSnapshot:copy(block),children:(block.relationships||[]).map(rel=>({id:id('child'),relationshipId:rel.id,
      kind:rel.kind,refId:rel.refId,required:rel.required!==false,status:'OPEN',definitionSnapshot:copy(byId(s,rel.kind==='Action'?'actions':'blocks',rel.refId))})),
    transitions:[],finishedAt:null,activationId:s.activations.find(x=>x.blockId===block.id)?.id||null};
  if(block.type==='workflow')r.children.forEach((child,index)=>{if(index)child.status='LOCKED';});
  s.runs.push(r);record(s,'run_started',{runId:r.id,blockId:block.id},at);return r;
}
function finishRun(s,run,at) {
  if(run.status!=='IN_PROGRESS')return;
  const end=run.deadlineAt&&run.deadlineAt<iso(at)?run.deadlineAt:iso(at);
  for(const child of run.children) {
    if(child.kind==='Action'&&child.definitionSnapshot?.direction==='Avoid') {
      const actual=avoidValue(s,child.definitionSnapshot,run.startedAt,end);
      const limit=Number(child.definitionSnapshot.avoid?.limit)||0;
      child.actual=actual;child.status=actual<=limit?'DONE':'MISSED';child.resolvedAt=iso(at);
    }
    if(child.kind==='Block'&&child.definitionSnapshot?.type==='routine'&&child.status==='OPEN') {
      const cadence=child.definitionSnapshot.config?.period||'daily';
      const nested=s.runs.filter(r=>r.blockId===child.refId&&r.startedAt>=run.startedAt&&r.startedAt<end);
      const expected=cadence==='daily'?Math.round((Date.parse(localKey(end,s.settings.timezone)+'T12:00:00Z')-Date.parse(localKey(run.startedAt,s.settings.timezone)+'T12:00:00Z'))/86400000):1;
      if(nested.length>=Math.max(1,expected)&&nested.every(r=>r.status==='COMPLETED')){child.status='DONE';child.resolvedAt=iso(at);}
    }
  }
  const required=run.children.filter(x=>x.required),done=required.filter(x=>x.status==='DONE');
  run.status=done.length===required.length?'COMPLETED':done.length?'MISSED':'MISSED';
  run.finishedAt=iso(at);record(s,`run_${run.status.toLowerCase()}`,{runId:run.id,blockId:run.blockId,completed:done.length,required:required.length},at);
}
function advanceWorkflow(run,child,at) {
  if(run.type!=='workflow'||child.status!=='DONE')return;
  const current=run.children.indexOf(child),next=run.children.slice(current+1).find(x=>x.status==='LOCKED');
  if(next){next.status='OPEN';next.availableAt=iso(at);run.transitions.push({id:id('transition'),event:'NEXT_STEP',at:iso(at),from:child.id,to:next.id});}
}
function reconcileRoutines(s,at) {
  const active=s.activations.filter(x=>x.status==='ACTIVE').sort((a,b)=>{
    const pa=a.schedule?.period||byId(s,'blocks',a.blockId)?.config?.period;
    const pb=b.schedule?.period||byId(s,'blocks',b.blockId)?.config?.period;
    return (pa==='daily'?0:1)-(pb==='daily'?0:1);
  });
  for(const activation of active) {
    const block=byId(s,'blocks',activation.blockId);if(!block||block.status==='ARCHIVED'||block.type!=='routine')continue;
    const cadence=activation.schedule?.period||block.config?.period||'manual';
    if(!['daily','weekly'].includes(cadence))continue;
    const current=periodBounds(cadence,at,s.settings),start=activation.startedAt||iso(at);
    let last=s.runs.filter(r=>r.activationId===activation.id).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).at(-1);
    if(!last) {const begin=periodBounds(cadence,start,s.settings);last=createRun(s,block,at,begin);}
    let guard=0;
    while(last.deadlineAt&&last.deadlineAt<=iso(at)&&guard++<740) {
      finishRun(s,last,last.deadlineAt);
      const next=periodBounds(cadence,new Date(last.deadlineAt).getTime()+1000,s.settings);
      if(next.start>=current.end)break;
      last=createRun(s,block,new Date(next.start).getTime(),next);
    }
  }
}
function eligibleEntry(e,at) {
  const time=iso(at);if(e.paused||e.status==='ARCHIVED')return false;
  if(e.activeFrom&&time<e.activeFrom||e.activeUntil&&time>=e.activeUntil)return false;
  return !(e.offPeriods||[]).some(p=>time>=p.start&&(!p.end||time<p.end)&&!p.notifiedAt);
}
function dueForDay(entry,key,settings) {
  const schedule=entry.schedule||{},mode=schedule.mode||'manual',zone=settings.timezone||'Europe/London';
  if(mode==='manual')return null;
  if(mode==='once')return schedule.at&&localKey(schedule.at,zone)===key?schedule.at:null;
  if(mode==='specific_dates'&&!(schedule.dates||[]).includes(key))return null;
  const weekday=new Date(key+'T12:00:00Z').getUTCDay();
  if(mode==='weekly'&&!(schedule.weekdays||[1]).includes(weekday))return null;
  if(mode==='monthly'&&Number(key.slice(8))!==Number(schedule.day||1))return null;
  if(mode==='yearly'&&(Number(key.slice(5,7))!==Number(schedule.month||1)||Number(key.slice(8))!==Number(schedule.day||1)))return null;
  if(mode==='interval') {
    const anchor=schedule.anchorAt||entry.createdAt; if(!anchor)return null;
    const period=Math.max(1,Number(schedule.every)||1);
    const aKey=localKey(anchor,zone),days=Math.round((Date.parse(key+'T12:00:00Z')-Date.parse(aKey+'T12:00:00Z'))/86400000);
    if(days<0||days%(period*(schedule.unit==='weeks'?7:1))!==0)return null;
  }
  if(!['daily','weekly','monthly','yearly','interval','specific_dates'].includes(mode))return null;
  return zoned(key,schedule.time||'09:00',zone);
}
function makeOccurrence(s,block,entry,due,at) {
  const target=entry.kind==='Action'?byId(s,'actions',entry.refId):null;
  const o={id:id('occurrence'),blockId:block.id,entryId:entry.id,entrySnapshot:copy(entry),
    itemSnapshot:target?copy(target):{name:entry.name},dueAt:due,
    deadlineAt:entry.deadlineMinutes!=null?iso(Date.parse(due)+Number(entry.deadlineMinutes)*60000):due,
    status:'OPEN',createdAt:iso(at),resolvedAt:null,snoozedUntil:null,actionLogId:null};
  s.occurrences.push(o);record(s,'occurrence_created',{occurrenceId:o.id,entryId:entry.id},at);return o;
}
function reconcileOccurrences(s,at,horizonDays=14) {
  const zone=s.settings.timezone||'Europe/London',today=localKey(at,zone);
  for(const block of s.blocks.filter(b=>b.type==='action_list'&&b.status!=='ARCHIVED'&&s.activations.some(a=>a.blockId===b.id&&a.status==='ACTIVE'))) {
    const activation=s.activations.find(a=>a.blockId===block.id&&a.status==='ACTIVE');
    for(const entry of block.entries||[]) {
      const earliest=[entry.activeFrom,entry.createdAt,activation?.startedAt].filter(Boolean).map(x=>localKey(x,zone)).sort().at(-1)||today;
      const last=s.occurrences.filter(o=>o.entryId===entry.id).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).at(-1);
      const from=last?dayShift(localKey(last.dueAt,zone),-1):earliest;
      const minDay=dayShift(today,-739);
      const start=from>minDay?from:minDay;
      const days=Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000);
      for(let d=0;d<=days+horizonDays;d++) {
        const key=dayShift(start,d);if(key<earliest)continue;
        const due=dueForDay(entry,key,s.settings);if(!due||!eligibleEntry(entry,due))continue;
        if(entry.repeatEnd&&due>=entry.repeatEnd)continue;
        if(s.occurrences.some(o=>o.entryId===entry.id&&o.dueAt===due))continue;
        if(entry.overlap==='block_next'&&s.occurrences.some(o=>o.entryId===entry.id&&['OPEN','OVERDUE','CARRIED'].includes(o.status)&&o.dueAt<due))continue;
        makeOccurrence(s,block,entry,due,at);
      }
    }
  }
  for(const o of s.occurrences.filter(x=>x.status==='OPEN'&&x.deadlineAt<=iso(at))) {
    const policy=o.entrySnapshot?.unfinished||'stay_overdue';
    if(policy==='expire') {o.status='MISSED';o.resolvedAt=o.deadlineAt;record(s,'occurrence_missed',{occurrenceId:o.id},at);}
    else if(policy==='carry_forward')o.status='CARRIED';
    else o.status='OVERDUE';
  }
}
function targetActual(s,block,bounds) {
  const logIds=new Set();
  const actionIds=new Set((block.relationships||[]).filter(r=>r.kind==='Action').map(r=>r.refId));
  function descendants(ref,seen=new Set()) {if(seen.has(ref))return;seen.add(ref);const b=byId(s,'blocks',ref);for(const r of b?.relationships||[]){if(r.kind==='Action')actionIds.add(r.refId);else descendants(r.refId,seen);}}
  for(const r of block.relationships||[])if(r.kind==='Block')descendants(r.refId);
  const logs=s.actionLogs.filter(l=>l.at>=bounds.start&&l.at<bounds.end&&actionIds.has(l.actionId)&&!logIds.has(l.id)&&logIds.add(l.id));
  const kind=block.config?.metric||'count';
  if(kind==='minutes')return logs.reduce((n,l)=>n+(l.durationMinutes||0),0);
  if(kind==='quantity')return logs.reduce((n,l)=>n+(l.quantity||0),0);
  if(kind==='result')return logs.reduce((n,l)=>n+(Number(l.results?.[block.config?.resultId]?.value??l.results?.[block.config?.resultId]??0)||0),0);
  return logs.length;
}
function reconcilePeriods(s,at) {
  for(const block of s.blocks.filter(b=>b.type==='target'&&b.status!=='ARCHIVED'&&s.activations.some(a=>a.blockId===b.id&&a.status==='ACTIVE'))) {
    const cadence=block.config?.period||'daily';let p=s.periods.filter(p=>p.blockId===block.id).sort((a,b)=>a.start.localeCompare(b.start)).at(-1);
    if(!p) {const b=periodBounds(cadence,at,s.settings);p={id:id('period'),blockId:block.id,blockSnapshot:copy(block),start:b.start,end:b.end,status:'OPEN',actual:0,target:Number(block.config?.target)||0};s.periods.push(p);}
    let guard=0;while(p.end<=iso(at)&&guard++<740) {
      p.actual=targetActual(s,p.blockSnapshot,{start:p.start,end:p.end});p.status=p.actual>=p.target?'REACHED':'MISSED';p.closedAt=p.end;
      record(s,'period_closed',{periodId:p.id,blockId:p.blockId,actual:p.actual,target:p.target},p.end);
      const b=periodBounds(cadence,new Date(p.end).getTime()+1000,s.settings);
      p={id:id('period'),blockId:block.id,blockSnapshot:copy(block),start:b.start,end:b.end,status:'OPEN',actual:0,target:Number(block.config?.target)||0};s.periods.push(p);
    }
    p.actual=targetActual(s,p.blockSnapshot,{start:p.start,end:iso(at)});
  }
}
function avoidValue(s,action,start,end) {
  return s.actionLogs.filter(l=>l.actionId===action.id&&l.at>=start&&l.at<end)
    .reduce((total,log)=>total+(log.quantity>0?log.quantity:1),0);
}
function reconcileAvoid(s,at) {
  for(const action of s.actions.filter(a=>a.direction==='Avoid'&&a.status!=='ARCHIVED')) {
    const cfg=action.avoid||{mode:'binary_limit',limit:0,period:'daily'},cadence=cfg.period||'daily';
    let period=s.periods.filter(p=>p.kind==='avoid'&&p.actionId===action.id).sort((a,b)=>a.start.localeCompare(b.start)).at(-1);
    if(!period) {
      const b=periodBounds(cadence,at,s.settings);
      period={id:id('period'),kind:'avoid',actionId:action.id,actionSnapshot:copy(action),start:b.start,end:b.end,status:'OPEN',actual:0,limit:Number(cfg.limit)||0};
      s.periods.push(period);
    }
    let guard=0;
    while(period.end<=iso(at)&&guard++<740) {
      period.actual=avoidValue(s,period.actionSnapshot,period.start,period.end);
      period.status=period.actual<=period.limit?'SUCCESS':'FAILED';period.closedAt=period.end;
      if(cfg.mode==='violation_multiplier')period.score=Math.max(0,100-period.actual*(Number(cfg.multiplier)||10));
      if(cfg.mode==='scored_range')period.score=Math.max(0,Math.min(100,100-period.actual*(Number(cfg.multiplier)||10)));
      record(s,'avoid_period_closed',{periodId:period.id,actionId:action.id,violations:period.actual,outcome:period.status},period.end);
      const b=periodBounds(cadence,new Date(period.end).getTime()+1000,s.settings);
      period={id:id('period'),kind:'avoid',actionId:action.id,actionSnapshot:copy(action),start:b.start,end:b.end,status:'OPEN',actual:0,limit:Number(cfg.limit)||0};
      s.periods.push(period);
    }
    period.actual=avoidValue(s,period.actionSnapshot,period.start,iso(at));
  }
}
function ensureCycles(s,at) {
  for(const b of s.blocks.filter(x=>x.type==='cycle'&&x.status!=='ARCHIVED'&&s.activations.some(a=>a.blockId===x.id&&a.status==='ACTIVE'))) {
    const existing=s.cycles.find(y=>y.blockId===b.id);
    if(existing?.sequence.length)continue;
    const slots=[];for(const r of b.relationships||[])for(let n=0;n<Math.max(1,Math.min(20,Number(r.weight)||1));n++)slots.push({relationshipId:r.id,refId:r.refId,kind:r.kind});
    if(existing)existing.sequence=slots;
    else s.cycles.push({id:id('cycle'),blockId:b.id,sequence:slots,index:0,round:1,createdAt:iso(at),history:[]});
  }
}
export function reconcile(input,at) {
  const s=copy(input);validate(s);reconcileRoutines(s,at);reconcileOccurrences(s,at);reconcilePeriods(s,at);reconcileAvoid(s,at);ensureCycles(s,at);return s;
}
function addActionLog(s,command,at) {
  const a=byId(s,'actions',command.actionId);insist(a&&a.status!=='ARCHIVED','Action unavailable.');
  const quantity=command.quantity==null?(a.direction==='Avoid'?1:0):Number(command.quantity),durationMinutes=command.durationMinutes==null?0:Number(command.durationMinutes);
  insist(Number.isFinite(quantity)&&quantity>=0&&Number.isFinite(durationMinutes)&&durationMinutes>=0,'Invalid quantity or time.');
  const kind=a.completion?.type||'quantity';if(a.direction!=='Avoid')insist((kind==='time'?durationMinutes:quantity)>0,'Log a positive amount.');
  const results={};for(const f of a.resultFields||[])results[f.id]=resultValue(f,command.results?.[f.id],s);
  const contexts=[...new Set(command.contexts||[])];
  const occurredAt=command.occurredAt?iso(command.occurredAt):iso(at);
  insist(Date.parse(occurredAt)<=Number(at)+600000,'The Action time cannot be in the future.');
  const log={id:id('log'),actionId:a.id,actionSnapshot:copy(a),resultSnapshots:copy(a.resultFields),at:occurredAt,recordedAt:iso(at),quantity,durationMinutes,results,contexts,notes:String(command.notes||'')};
  s.actionLogs.push(log);
  for(const ref of contexts) {
    const o=byId(s,'occurrences',ref);if(o&&['OPEN','OVERDUE','CARRIED'].includes(o.status)&&o.itemSnapshot?.id===a.id) {o.status='COMPLETED';o.resolvedAt=iso(at);o.actionLogId=log.id;}
    for(const run of s.runs)for(const child of run.children)if(child.id===ref&&child.refId===a.id&&child.status==='OPEN') {
      if(child.definitionSnapshot?.direction==='Avoid')continue;
      const completion=child.definitionSnapshot?.completion||{type:'quantity',target:1};
      const delta=completion.type==='time'?durationMinutes:quantity;
      child.progress=(child.progress||0)+delta;
      child.actionLogIds=[...(child.actionLogIds||[]),log.id];child.actionLogId=log.id;
      const required=completion.type==='time'?Math.max(1,Number(completion.minimumMinutes)||1):Math.max(1,Number(completion.target)||1);
      if(child.progress>=required){child.status='DONE';child.completedAt=iso(at);advanceWorkflow(run,child,at);}
    }
  }
  record(s,'action_logged',{actionLogId:log.id,actionId:a.id,contexts,occurredAt},at);return log;
}
function addDefinition(s,kind,data,at) {
  insist(['categories','tags','units','actions','blocks'].includes(kind),'Invalid definition.');
  const obj=copy(data);obj.id=obj.id||id(kind.slice(0,-1));obj.createdAt=iso(at);obj.updatedAt=iso(at);obj.status=obj.status||'ACTIVE';
  if(kind==='actions') {obj.tagIds=obj.tagIds||[];obj.resultFields=obj.resultFields||[];obj.direction=obj.direction||'Do';obj.completion=obj.completion||{type:'quantity',target:1};for(const r of obj.resultFields){r.id=r.id||id('result');r.definitionVersion=r.definitionVersion||1;}}
  if(kind==='blocks') {obj.relationships=obj.relationships||[];if(obj.type==='action_list')obj.entries=obj.entries||[];obj.config=obj.config||{};}
  s[kind].push(obj);record(s,'definition_created',{kind,definitionId:obj.id},at);return obj;
}
function addStarter(s,which,at) {
  insist(['religion','hygiene','nutrition'].includes(which),'Unknown starter routine.');
  insist(!s.blocks.some(b=>b.templateKey===which),'This starter routine already exists.');
  const category=addDefinition(s,'categories',{name:which==='religion'?'Religion':which==='hygiene'?'Hygiene':'Nutrition'},at);
  const tag=addDefinition(s,'tags',{name:'Daily practice',categoryId:category.id},at);
  const makeAction=(name,completion={type:'quantity',target:1},more={})=>addDefinition(s,'actions',{name,tagIds:[tag.id],completion,...more},at);
  const makeBlock=(name,period,key)=>addDefinition(s,'blocks',{name,type:'routine',templateKey:key,config:{period}},at);
  const link=(block,kind,ref,required=true)=>block.relationships.push({id:id('relation'),kind,refId:ref.id,required,weight:1,config:{}});
  const activate=(block,period)=>s.activations.push({id:id('activation'),blockId:block.id,status:'ACTIVE',startedAt:iso(at),schedule:{period}});
  if(which==='religion') {
    const daily=makeBlock('Daily prayer','daily','religion_prayer');
    for(const name of ['Fajr','Dhuhr','Asr','Maghrib','Isha']) {
      const action=makeAction(name,{type:'quantity',target:1},{resultFields:[{label:'How was this prayer? (0–10)',type:'score',minimum:0,maximum:10,required:false}]});
      link(daily,'Action',action);
    }
    const weekly=makeBlock('Religion','weekly',which);link(weekly,'Block',daily);
    for(const name of ['Jumu’ah','Extra prayer','Quran reading','Memorisation']) {
      const action=makeAction(name,{type:name.includes('reading')||name==='Memorisation'?'time':'quantity',target:1,minimumMinutes:1});
      link(weekly,'Action',action,false);
    }
    activate(daily,'daily');activate(weekly,'weekly');return {daily,weekly};
  }
  if(which==='hygiene') {
    const daily=makeBlock('Daily hygiene','daily','hygiene_daily');
    link(daily,'Action',makeAction('Brush teeth',{type:'quantity',target:2}));
    link(daily,'Action',makeAction('Wash face',{type:'quantity',target:1}));
    const weekly=makeBlock('Hygiene','weekly',which);link(weekly,'Block',daily);
    link(weekly,'Action',makeAction('Shower',{type:'quantity',target:2}));
    link(weekly,'Action',makeAction('Laundry',{type:'quantity',target:1}),false);
    activate(daily,'daily');activate(weekly,'weekly');return {daily,weekly};
  }
  const daily=makeBlock('Daily nutrition','daily',which);
  link(daily,'Action',makeAction('Nutrition check-in',{type:'quantity',target:1},{resultFields:[{label:'How did eating feel?',type:'text',required:false}]}));
  activate(daily,'daily');return {daily};
}
function dependencies(s,kind,target) {
  const refs=[];
  if(kind==='actions')for(const b of s.blocks) {for(const r of b.relationships||[])if(r.kind==='Action'&&r.refId===target)refs.push(b.name);for(const e of b.entries||[])if(e.kind==='Action'&&e.refId===target)refs.push(b.name);}
  if(kind==='actions'){
    if(s.occurrences.some(o=>o.itemSnapshot?.id===target&&['OPEN','OVERDUE','CARRIED'].includes(o.status)))refs.push('open occurrence');
    if(s.runs.some(run=>run.status==='IN_PROGRESS'&&run.children.some(c=>c.kind==='Action'&&c.refId===target&&c.status==='OPEN')))refs.push('active Run');
  }
  if(kind==='blocks'){
    for(const b of s.blocks)for(const r of b.relationships||[])if(r.kind==='Block'&&r.refId===target)refs.push(b.name);
    if(s.activations.some(a=>a.blockId===target&&a.status==='ACTIVE'))refs.push('active Block');
    if(s.runs.some(r=>r.blockId===target&&r.status==='IN_PROGRESS'))refs.push('active Run');
  }
  if(kind==='categories')for(const tag of s.tags)if(tag.categoryId===target)refs.push(tag.name);
  if(kind==='tags')for(const a of s.actions)if((a.tagIds||[]).includes(target))refs.push(a.name);
  return refs;
}
export function execute(input,command,at) {
  insist(command&&typeof command.type==='string','Command required.');
  const s=reconcile(input,at);let value=null;
  switch(command.type) {
    case 'ADD_DEFINITION':value=addDefinition(s,command.kind,command.data,at);break;
    case 'ADD_STARTER':value=addStarter(s,command.which,at);break;
    case 'EDIT_DEFINITION':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');
      const revised={...d,...copy(command.changes),id:d.id,createdAt:d.createdAt,updatedAt:iso(at)};
      if(command.kind==='actions'&&command.changes.resultFields)for(const field of revised.resultFields) {
        const old=d.resultFields.find(x=>x.id===field.id);field.id=field.id||id('result');
        field.definitionVersion=old?old.definitionVersion+(JSON.stringify({...old,definitionVersion:0})===JSON.stringify({...field,definitionVersion:0})?0:1):1;
      }
      Object.assign(d,revised);record(s,'definition_edited',{kind:command.kind,definitionId:d.id},at);value=d;break;
    }
    case 'ADD_RELATIONSHIP':{
      const b=byId(s,'blocks',command.blockId);insist(b,'Block not found.');
      const r={id:id('relation'),kind:command.kind,refId:command.refId,required:command.required!==false,weight:command.weight||1,config:copy(command.config||{})};
      b.relationships.push(r);b.updatedAt=iso(at);record(s,'relationship_added',{blockId:b.id,relationshipId:r.id},at);value=r;break;
    }
    case 'ADD_ENTRY':{
      const b=byId(s,'blocks',command.blockId);insist(b?.type==='action_list','Action List not found.');
      const e={id:id('entry'),kind:command.kind,refId:command.refId||null,name:command.name||'',schedule:copy(command.schedule||{mode:'manual'}),
        activeFrom:command.activeFrom||null,activeUntil:command.activeUntil||null,deadlineMinutes:command.deadlineMinutes??null,
        repeatEnd:command.repeatEnd||null,offPeriods:[],reminderMinutes:copy(command.reminderMinutes||[]),alarm:!!command.alarm,
        unfinished:command.unfinished||'stay_overdue',overlap:command.overlap||'keep_each',status:'ACTIVE',paused:false,createdAt:iso(at),updatedAt:iso(at)};
      b.entries.push(e);record(s,'entry_added',{blockId:b.id,entryId:e.id},at);value=e;break;
    }
    case 'START_MANUAL_OCCURRENCE':{
      const b=byId(s,'blocks',command.blockId),e=b?.entries?.find(x=>x.id===command.entryId);
      insist(b?.type==='action_list'&&e?.schedule?.mode==='manual','Manual entry not found.');
      insist(s.activations.some(a=>a.blockId===b.id&&a.status==='ACTIVE'),'Activate the Action List first.');
      insist(eligibleEntry(e,at),'Entry is unavailable during this period.');
      value=makeOccurrence(s,b,e,iso(at),at);break;
    }
    case 'EDIT_ENTRY':{
      const b=byId(s,'blocks',command.blockId),e=b?.entries?.find(x=>x.id===command.entryId);insist(e,'Entry not found.');
      Object.assign(e,copy(command.changes),{id:e.id,createdAt:e.createdAt,updatedAt:iso(at)});
      record(s,'entry_edited',{entryId:e.id},at);value=e;break;
    }
    case 'OFF_PERIOD':{
      const e=byId(s,'blocks',command.blockId)?.entries?.find(x=>x.id===command.entryId);insist(e,'Entry not found.');
      const p={id:id('off'),start:iso(command.start),end:command.end?iso(command.end):null,untilNotified:!!command.untilNotified,notifiedAt:null};
      insist(!p.end||p.end>p.start,'Off Period must end after it starts.');e.offPeriods.push(p);value=p;record(s,'off_period_added',{entryId:e.id,offId:p.id},at);break;
    }
    case 'STOP_OFF_PERIOD':{
      const e=byId(s,'blocks',command.blockId)?.entries?.find(x=>x.id===command.entryId),p=e?.offPeriods?.find(x=>x.id===command.offId);insist(p,'Off Period not found.');
      p.notifiedAt=iso(at);p.end=iso(at);record(s,'off_period_ended',{entryId:e.id,offId:p.id},at);break;
    }
    case 'PAUSE_ENTRY':{
      const e=byId(s,'blocks',command.blockId)?.entries?.find(x=>x.id===command.entryId);insist(e,'Entry not found.');
      e.paused=!!command.paused;e.updatedAt=iso(at);record(s,e.paused?'entry_paused':'entry_resumed',{entryId:e.id},at);value=e;break;
    }
    case 'ACTIVATE':{
      const b=byId(s,'blocks',command.blockId);insist(b&&b.status!=='ARCHIVED'&&b.type!=='collection','Executable Block not found.');
      let activation=s.activations.find(x=>x.blockId===b.id);
      if(!activation) {activation={id:id('activation'),blockId:b.id,status:'ACTIVE',startedAt:iso(at),schedule:copy(command.schedule||{period:'manual'})};s.activations.push(activation);}
      else Object.assign(activation,{status:'ACTIVE',schedule:copy(command.schedule||activation.schedule)});
      if(['workflow','project'].includes(b.type)&&!s.runs.some(x=>x.blockId===b.id&&x.status==='IN_PROGRESS'))createRun(s,b,at);
      record(s,'block_activated',{blockId:b.id},at);value=activation;break;
    }
    case 'RUN_NOW':{const b=byId(s,'blocks',command.blockId);insist(b&&b.status!=='ARCHIVED'&&['routine','workflow','project'].includes(b.type),'Block cannot start a Run.');
      insist(!s.activations.some(a=>a.blockId===b.id&&a.status==='ACTIVE'&&['daily','weekly'].includes(a.schedule?.period)),'Calendar Routine starts automatically.');
      value=createRun(s,b,at);break;}
    case 'LOG_ACTION':value=addActionLog(s,command,at);break;
    case 'COMPLETE_TODO':{
      const o=byId(s,'occurrences',command.occurrenceId);insist(o?.entrySnapshot?.kind==='Todo'&&['OPEN','OVERDUE','CARRIED'].includes(o.status),'Open Todo occurrence not found.');
      o.status='COMPLETED';o.resolvedAt=iso(at);record(s,'todo_completed',{occurrenceId:o.id},at);value=o;break;
    }
    case 'SKIP_OCCURRENCE':{
      const o=byId(s,'occurrences',command.occurrenceId);insist(o&&['OPEN','OVERDUE','CARRIED'].includes(o.status),'Open occurrence not found.');
      o.status='SKIPPED';o.resolvedAt=iso(at);o.skipReason=command.reason||'';record(s,'occurrence_skipped',{occurrenceId:o.id,reason:o.skipReason},at);value=o;break;
    }
    case 'SNOOZE':{
      const o=byId(s,'occurrences',command.occurrenceId);insist(o&&['OPEN','OVERDUE'].includes(o.status),'Cannot snooze this occurrence.');
      o.snoozedUntil=iso(Number(at)+Math.max(1,Number(command.minutes)||10)*60000);record(s,'occurrence_snoozed',{occurrenceId:o.id,until:o.snoozedUntil},at);value=o;break;
    }
    case 'RESOLVE_CHILD':{
      const run=byId(s,'runs',command.runId),child=run?.children.find(c=>c.id===command.childId);insist(child&&run.status==='IN_PROGRESS','Open Run child not found.');
      insist(['DONE','SKIPPED'].includes(command.status),'Invalid child outcome.');child.status=command.status;child.resolvedAt=iso(at);child.notes=command.notes||'';
      advanceWorkflow(run,child,at);record(s,'run_child_resolved',{runId:run.id,childId:child.id,status:child.status},at);value=child;break;
    }
    case 'RETURN_STEP':{
      const run=byId(s,'runs',command.runId);insist(run?.type==='workflow'&&run.status==='IN_PROGRESS','Open Workflow Run not found.');
      const target=run.children.findIndex(x=>x.id===command.childId);insist(target>=0,'Step not found.');
      run.children.forEach((x,i)=>{if(i>target&&x.status==='OPEN')x.status='LOCKED';});
      run.children[target].status='OPEN';run.transitions.push({id:id('transition'),event:'RETURN_STEP',at:iso(at),to:command.childId});
      record(s,'workflow_returned',{runId:run.id,childId:command.childId},at);value=run;break;
    }
    case 'FINISH_RUN':{const run=byId(s,'runs',command.runId);insist(run,'Run not found.');finishRun(s,run,at);value=run;break;}
    case 'RESOLVE_CYCLE':{
      const cycle=s.cycles.find(x=>x.blockId===command.blockId);insist(cycle&&cycle.sequence.length,'Cycle has no participants.');
      const slot=cycle.sequence[cycle.index];cycle.history.push({id:id('cycle_event'),at:iso(at),index:cycle.index,outcome:command.outcome,slot:copy(slot)});
      const block=byId(s,'blocks',cycle.blockId),policy=block?.config?.missedPolicy||s.settings.defaults?.cycleMissed||'keep_position';
      if(command.outcome==='COMPLETED'||command.outcome==='MISSED'&&policy==='skip_to_next')cycle.index++;
      if(command.outcome==='MISSED'&&policy==='restart')cycle.index=0;
      if(cycle.index>=cycle.sequence.length) {cycle.index=0;cycle.round++;}
      record(s,'cycle_resolved',{blockId:cycle.blockId,outcome:command.outcome,position:cycle.index},at);value=cycle;break;
    }
    case 'ADD_REVIEW':value={id:id('review'),at:iso(at),period:command.period||'week',notes:String(command.notes||''),highlights:String(command.highlights||''),next:String(command.next||'')};s.reviews.push(value);record(s,'review_saved',{reviewId:value.id},at);break;
    case 'SET_SETTINGS':s.settings={...s.settings,...copy(command.changes)};record(s,'settings_changed',{keys:Object.keys(command.changes)},at);break;
    case 'ARCHIVE':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');d.status='ARCHIVED';d.updatedAt=iso(at);
      if(command.kind==='blocks'){
        const a=s.activations.find(x=>x.blockId===d.id&&x.status==='ACTIVE');if(a)a.status='INACTIVE';
        for(const run of s.runs.filter(x=>x.blockId===d.id&&x.status==='IN_PROGRESS'))finishRun(s,run,at);
      }
      record(s,'definition_archived',{kind:command.kind,definitionId:d.id},at);value=d;break;
    }
    case 'BIN':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');const dep=dependencies(s,command.kind,d.id);
      insist(!dep.length,`Used by: ${dep.join(', ')}`);
      s[command.kind]=s[command.kind].filter(x=>x.id!==d.id);const item={id:id('bin'),kind:command.kind,originalId:d.id,snapshot:copy(d),deletedAt:iso(at)};
      s.bin.push(item);record(s,'definition_binned',{kind:command.kind,definitionId:d.id,binId:item.id},at);value=item;break;
    }
    case 'RESTORE':{
      const item=byId(s,'bin',command.binId);insist(item,'Bin item not found.');insist(!byId(s,item.kind,item.originalId),'Cannot restore conflicting ID.');
      s[item.kind].push(copy(item.snapshot));s.bin=s.bin.filter(x=>x.id!==item.id);record(s,'definition_restored',{kind:item.kind,definitionId:item.originalId},at);value=item.snapshot;break;
    }
    case 'PERMANENT_DELETE':{
      const item=byId(s,'bin',command.binId);insist(item,'Bin item not found.');s.bin=s.bin.filter(x=>x.id!==item.id);
      record(s,'definition_deleted',{kind:item.kind,definitionId:item.originalId,displayName:item.snapshot.name},at);break;
    }
    default:throw new Error(`Unknown command: ${command.type}`);
  }
  validate(s);s.meta.updatedAt=iso(at);
  // Apply the new command before generating runtime. Definition state by itself
  // never starts a Run, Period, Cycle or scheduled List occurrence.
  return {state:reconcile(s,at),value};
}
export function actionAnalysis(s,actionId) {
  const logs=s.actionLogs.filter(l=>l.actionId===actionId);
  return {logs:logs.length,minutes:logs.reduce((n,x)=>n+(x.durationMinutes||0),0),quantity:logs.reduce((n,x)=>n+(x.quantity||0),0),last:logs.at(-1)||null};
}
export function overview(s) {
  const ids=new Set();let minutes=0;
  for(const log of s.actionLogs)if(!ids.has(log.id)){ids.add(log.id);minutes+=(log.durationMinutes||0);}
  return {logs:ids.size,uniqueMinutes:minutes,completedRuns:s.runs.filter(x=>x.status==='COMPLETED').length,openRuns:s.runs.filter(x=>x.status==='IN_PROGRESS').length};
}
export function home(s,at) {
  const date=iso(at),open=s.occurrences.filter(x=>['OPEN','OVERDUE','CARRIED'].includes(x.status));
  const due=open.filter(x=>x.dueAt<=date).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  const today=localKey(at,s.settings.timezone),week=periodBounds('weekly',at,s.settings);
  return {now:s.runs.find(x=>x.status==='IN_PROGRESS')||due[0]||null,due,avoid:s.actions.filter(x=>x.direction==='Avoid'),
    today:open.filter(x=>localKey(x.dueAt,s.settings.timezone)===today),
    week:open.filter(x=>x.dueAt>=week.start&&x.dueAt<week.end),
    project:s.runs.find(x=>x.type==='project'&&x.status==='IN_PROGRESS')||null,
    upcoming:open.filter(x=>x.dueAt>date).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,8)};
}
export function alarmRequests(s,at) {
  const current=Number(at),items=[];
  for(const o of s.occurrences) {
    if(!['OPEN','OVERDUE','CARRIED'].includes(o.status))continue;
    const e=o.entrySnapshot||{},title=o.itemSnapshot?.name||e.name||'SAMT reminder';
    for(const minutes of e.reminderMinutes||[]) {
      const when=Date.parse(o.dueAt)-Number(minutes)*60000;
      if(when>current)items.push({id:`${o.id}:${minutes}`,at:when,title,body:'Upcoming in SAMT',kind:'reminder'});
    }
    const alarmTime=o.snoozedUntil?Date.parse(o.snoozedUntil):Date.parse(o.dueAt);
    if(e.alarm&&alarmTime>current)items.push({id:`${o.id}:alarm`,at:alarmTime,title,body:'Your SAMT alarm is due',kind:'alarm'});
  }
  return items.sort((a,b)=>a.at-b.at).slice(0,250);
}
export function backup(s,at) {validate(s);return JSON.stringify({format:'samt-android-backup',schemaVersion:VERSION,exportedAt:iso(at),state:s},null,2);}
export function importBackup(data) {
  const packageData=typeof data==='string'?JSON.parse(data):copy(data);
  insist(packageData?.format==='samt-android-backup'&&packageData.schemaVersion===VERSION,'Unsupported backup format.');
  const candidate=copy(packageData.state);validate(candidate);return candidate;
}
