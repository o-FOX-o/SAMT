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
  if(kind==='all_time')return {key:'all_time',start:'1970-01-01T00:00:00.000Z',end:'9999-12-31T23:59:59.999Z',timezone:zone};
  const today=localKey(instant,zone); let start=today,end=dayShift(today,1);
  if(kind==='weekly') {start=weekStart(today,first);end=dayShift(start,7);}
  if(kind==='monthly') {start=today.slice(0,7)+'-01';const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);end=d.toISOString().slice(0,10);}
  if(kind==='yearly') {start=today.slice(0,4)+'-01-01';end=String(Number(today.slice(0,4))+1)+'-01-01';}
  return {key:start,start:zoned(start,'00:00',zone),end:zoned(end,'00:00',zone),timezone:zone};
}
export function emptyState() {
  return {format:'samt',schemaVersion:VERSION,settings:{timezone:'Europe/London',weekStartsOn:1,appearance:'system',accent:'#147d86',categoryColors:{},capacityHours:40,defaults:{cycleMissed:'keep_position',cyclePosition:'continue',cycleAutoClose:true,targetAutoClose:true,actionListUnfinished:'expire'}},
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
function assertUniqueBlockTree(s,root) {
  const seen=new Map([[root.id,[root.name]]]);
  function walk(block,path,ancestors) {
    for(const r of block.relationships||[]) {
      if(r.kind!=='Block')continue;
      const child=byId(s,'blocks',r.refId);if(!child)continue;
      const next=[...path,child.name];
      insist(!ancestors.has(child.id),`Circular Block path: ${next.join(' → ')}`);
      const existing=seen.get(child.id);
      insist(!existing,`${child.name} already exists at: ${existing?.join(' → ')}`);
      seen.set(child.id,next);walk(child,next,new Set([...ancestors,child.id]));
    }
  }
  walk(root,[root.name],new Set([root.id]));
}
function assertProjectDependencies(block) {
  if(block.type!=='project')return;
  const rels=block.relationships||[],ids=new Set(rels.map(r=>r.id)),graph=new Map();
  for(const r of rels) {
    const deps=r.config?.dependsOn||[];
    insist(new Set(deps).size===deps.length,'A Project child has duplicate dependencies.');
    insist(deps.every(x=>ids.has(x)&&x!==r.id),'Project dependency references a missing or self child.');
    graph.set(r.id,deps);
  }
  const visiting=new Set(),done=new Set();
  function walk(id) {
    if(done.has(id))return;
    insist(!visiting.has(id),'Circular Project dependency.');
    visiting.add(id);for(const dep of graph.get(id)||[])walk(dep);visiting.delete(id);done.add(id);
  }
  for(const id of graph.keys())walk(id);
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
    const directActions=block.relationships.filter(r=>r.kind==='Action').map(r=>r.refId);
    insist(new Set(directActions).size===directActions.length,'The same Action cannot appear twice in one Block.');
    const directBlocks=block.relationships.filter(r=>r.kind==='Block').map(r=>r.refId);
    insist(new Set(directBlocks).size===directBlocks.length,'The same Block cannot appear twice in one Block.');
    if(block.type==='project') {
      const cfg=block.config||{};
      if(cfg.plannedStartAt)insist(Number.isFinite(Date.parse(cfg.plannedStartAt)),'Project planned start is invalid.');
      if(cfg.deadlineAt)insist(Number.isFinite(Date.parse(cfg.deadlineAt)),'Project deadline is invalid.');
      insist(['continue_overdue','expire_unfinished'].includes(cfg.deadlinePolicy||'continue_overdue'),'Unknown Project deadline policy.');
      insist(['ready_to_finish','auto_finish'].includes(cfg.finishBehavior||'ready_to_finish'),'Unknown Project finish behaviour.');
      for(const r of block.relationships) {
        const rc=r.config||{};
        if(rc.availableAt)insist(Number.isFinite(Date.parse(rc.availableAt)),'Project child availability is invalid.');
        if(rc.deadlineAt)insist(Number.isFinite(Date.parse(rc.deadlineAt)),'Project child deadline is invalid.');
        if(rc.availableOffsetMinutes!=null)insist(Number(rc.availableOffsetMinutes)>=0,'Project child availability offset is invalid.');
        if(rc.deadlineOffsetMinutes!=null)insist(Number(rc.deadlineOffsetMinutes)>=0,'Project child deadline offset is invalid.');
      }
      assertProjectDependencies(block);
      insist(['all','any'].includes(cfg.conditionMode||'all'),'Unknown Project condition logic.');
      const conditions=cfg.conditions||[];
      insist(Array.isArray(conditions)&&conditions.length<=10,'Projects allow up to ten completion conditions.');
      for(const condition of conditions) {
        insist(['required','count','percentage','target','result','manual'].includes(condition.type),'Unknown Project completion condition.');
        if(condition.type==='count')insist(Number(condition.value)>=0,'Project count condition is invalid.');
        if(condition.type==='percentage')insist(Number(condition.value)>=0&&Number(condition.value)<=100,'Project percentage must be 0–100.');
        if(condition.type==='target')insist(byId(s,'blocks',condition.targetBlockId)?.type==='target','Project Target condition references a missing Target.');
        if(condition.type==='result') {
          const action=byId(s,'actions',condition.actionId),field=action?.resultFields?.find(x=>x.id===condition.resultId);
          insist(action&&field&&['percentage','score','measurement'].includes(field.type),'Project Result condition requires a numeric Action Result.');
          insist(['>=','>','<=','<','==','!='].includes(condition.operator||'>='),'Unknown Project Result comparison.');
          insist(['latest','average','sum','min','max'].includes(condition.aggregate||'latest'),'Unknown Project Result aggregation.');
          insist(Number.isFinite(Number(condition.value)),'Project Result threshold is invalid.');
        }
      }
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
  for(const block of s.blocks)assertUniqueBlockTree(s,block);
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
function relationshipDue(rel,bounds,at,s,cadence) {
  const config=rel.config||{};if(!config.time)return null;
  let key=localKey(bounds?.start||at,s.settings.timezone),dueKey=key;
  if(cadence==='weekly'&&config.weekday!==null&&config.weekday!==undefined&&config.weekday!=='') {
    const current=new Date(`${key}T12:00:00Z`).getUTCDay(),wanted=Number(config.weekday);
    dueKey=dayShift(key,(wanted-current+7)%7);
  }
  return zoned(dueKey,config.time,s.settings.timezone);
}
const WORKING_RUN_STATUSES=['IN_PROGRESS','READY_TO_FINISH','OVERDUE'];
function isWorkingRun(run){return !!run&&WORKING_RUN_STATUSES.includes(run.status);}
function relativeInstant(start,absolute,offsetMinutes) {
  if(absolute)return iso(absolute);
  const offset=Number(offsetMinutes);return Number.isFinite(offset)&&offset>0?iso(Date.parse(start)+offset*60000):null;
}
function refreshProjectChildren(run,at) {
  if(run.type!=='project')return;
  const when=iso(at),byRelationship=new Map((run.children||[]).map(c=>[c.relationshipId,c]));
  for(const child of run.children||[]) {
    if(PROJECT_CHILD_TERMINAL.includes(child.status))continue;
    child.overdue=!!child.dueAt&&child.dueAt<=when;
    if(child.status==='BLOCKED')continue;
    const dependencies=child.config?.dependsOn||[];
    const locked=dependencies.some(id=>!PROJECT_CHILD_SATISFIED.includes(byRelationship.get(id)?.status));
    if(locked)child.status='LOCKED';
    else if(child.status==='LOCKED')child.status='OPEN';
  }
}
function createRun(s,block,at,bounds=null,cadence=block.config?.period||'manual') {
  const startedAt=bounds?.start||iso(at),project=block.type==='project',cfg=block.config||{};
  const projectDeadline=project?relativeInstant(startedAt,cfg.deadlineAt,cfg.deadlineOffsetMinutes):null;
  const r={id:id('run'),blockId:block.id,type:block.type,startedAt,deadlineAt:project?projectDeadline:(bounds?.end||null),
    plannedStartAt:project?(cfg.plannedStartAt||null):null,actualStartAt:project?startedAt:null,overdueAt:null,
    status:'IN_PROGRESS',blockSnapshot:copy(block),children:(block.relationships||[]).map(rel=>{
      const rc=rel.config||{},child={id:id('child'),relationshipId:rel.id,kind:rel.kind,refId:rel.refId,required:rel.required!==false,status:'OPEN',
        config:copy(rc),dueAt:relationshipDue(rel,bounds,at,s,cadence),snoozedUntil:null,
        definitionSnapshot:copy(byId(s,rel.kind==='Action'?'actions':'blocks',rel.refId))};
      if(project) {
        child.availableAt=relativeInstant(startedAt,rc.availableAt,rc.availableOffsetMinutes);
        child.dueAt=relativeInstant(startedAt,rc.deadlineAt,rc.deadlineOffsetMinutes);
        child.milestone=!!rc.milestone;
      }
      return child;
    }),transitions:[],finishedAt:null,activationId:s.activations.find(x=>x.blockId===block.id)?.id||null};
  if(block.type==='workflow')r.children.forEach((child,index)=>{if(index)child.status='LOCKED';});
  if(project)refreshProjectChildren(r,at);
  s.runs.push(r);record(s,'run_started',{runId:r.id,blockId:block.id},at);return r;
}
const PROJECT_CHILD_TERMINAL=['DONE','SKIPPED','EXCUSED','NOT_APPLICABLE','MISSED','REMOVED'];
const PROJECT_CHILD_SATISFIED=['DONE','EXCUSED','NOT_APPLICABLE'];
function projectChildrenInScope(run){return (run.children||[]).filter(c=>c.inScope!==false&&c.status!=='REMOVED');}
function compareValue(actual,operator,expected){
  if(actual==null||!Number.isFinite(Number(actual))||!Number.isFinite(Number(expected)))return false;
  const a=Number(actual),b=Number(expected);
  if(operator==='>')return a>b;if(operator==='<=')return a<=b;if(operator==='<')return a<b;if(operator==='==')return a===b;if(operator==='!=')return a!==b;
  return a>=b;
}
function projectConditionResult(s,run,condition,at,children) {
  const type=condition.type||'required',now=iso(at);
  try {
    if(type==='required') {
      const required=children.filter(c=>c.required),resolved=required.filter(c=>PROJECT_CHILD_SATISFIED.includes(c.status)).length;
      return {id:condition.id||'required',type,reached:resolved===required.length,actual:{resolved,total:required.length},error:null};
    }
    if(type==='count') {
      const actual=children.filter(c=>c.status==='DONE').length,target=Math.max(0,Number(condition.value)||0);
      return {id:condition.id||'count',type,reached:actual>=target,actual,target,error:null};
    }
    if(type==='percentage') {
      const applicable=children.filter(c=>c.status!=='NOT_APPLICABLE'),resolved=applicable.filter(c=>['DONE','EXCUSED'].includes(c.status)).length;
      const actual=applicable.length?resolved/applicable.length*100:100,target=Math.max(0,Number(condition.value)||0);
      return {id:condition.id||'percentage',type,reached:actual>=target,actual,target,error:null};
    }
    if(type==='target') {
      const period=s.periods.filter(p=>p.blockId===condition.targetBlockId&&p.start<=now&&p.end>run.startedAt).sort((a,b)=>a.start.localeCompare(b.start)).at(-1);
      if(!period)return {id:condition.id||'target',type,reached:false,actual:null,error:'Target has no evaluated period yet.'};
      const target=condition.value==null?Number(period.target)||0:Number(condition.value),operator=condition.operator||'>=',actual=Number(period.actual)||0;
      return {id:condition.id||'target',type,reached:compareValue(actual,operator,target),actual,target,operator,periodId:period.id,error:null};
    }
    if(type==='result') {
      const values=s.actionLogs.filter(l=>l.actionId===condition.actionId&&l.at>=run.startedAt&&l.at<=now).map(l=>l.results?.[condition.resultId])
        .map(v=>Number(v?.value??v)).filter(Number.isFinite);
      if(!values.length)return {id:condition.id||'result',type,reached:false,actual:null,error:null};
      const aggregate=condition.aggregate||'latest';let actual=values.at(-1);
      if(aggregate==='sum')actual=values.reduce((n,x)=>n+x,0);if(aggregate==='average')actual=values.reduce((n,x)=>n+x,0)/values.length;if(aggregate==='min')actual=Math.min(...values);if(aggregate==='max')actual=Math.max(...values);
      const target=Number(condition.value),operator=condition.operator||'>=';
      return {id:condition.id||'result',type,reached:compareValue(actual,operator,target),actual,target,operator,aggregate,error:null};
    }
    if(type==='manual')return {id:condition.id||'manual',type,reached:!!run.manualConditionSatisfied,actual:!!run.manualConditionSatisfied,error:null};
    return {id:condition.id||'unknown',type,reached:false,actual:null,error:'Unknown condition.'};
  } catch(error) {return {id:condition.id||type,type,reached:false,actual:null,error:error.message||String(error)};}
}
function projectCompletionConditions(run) {
  const cfg=run.blockSnapshot?.config||{};
  if(Array.isArray(cfg.conditions)&&cfg.conditions.length)return cfg.conditions;
  const mode=cfg.completionMode||'required_only';
  if(mode==='count')return [{id:'base-count',type:'count',value:Number(cfg.completionValue)||1}];
  if(mode==='percentage')return [{id:'base-percentage',type:'percentage',value:Number(cfg.completionValue)||0}];
  if(mode==='manual'||mode==='open_ended')return [{id:'base-manual',type:'manual'}];
  return [{id:'base-required',type:'required'}];
}
function runProgress(run,s=null,at=Date.now()) {
  const all=run.children||[],children=run.type==='project'?projectChildrenInScope(run):all,done=children.filter(x=>x.status==='DONE').length;
  const required=children.filter(x=>x.required);
  if(run.type==='project') {
    const mandatory=children.filter(x=>x.required||x.milestone),mandatoryDone=mandatory.every(x=>PROJECT_CHILD_SATISFIED.includes(x.status));
    const conditions=projectCompletionConditions(run),conditionResults=s?conditions.map(c=>projectConditionResult(s,run,c,at,children)):[];
    const conditionMode=run.blockSnapshot?.config?.conditionMode||'all';
    const conditionsReached=conditionResults.length?(conditionMode==='any'?conditionResults.some(x=>x.reached):conditionResults.every(x=>x.reached)):false;
    const applicable=children.filter(c=>c.status!=='NOT_APPLICABLE'),resolved=applicable.filter(c=>['DONE','EXCUSED'].includes(c.status)).length;
    return {done,total:children.length,required:mandatory.length,requiredDone:mandatoryDone,percentage:applicable.length?Math.min(100,resolved/applicable.length*100):100,
      satisfied:mandatoryDone&&conditionsReached,mode:conditionMode,conditionMode,conditionResults};
  }
  const requiredDone=required.every(x=>x.status==='DONE'),config=run.blockSnapshot?.config||{},mode=config.completionMode||'required_only';
  let threshold=false;
  if(mode==='count')threshold=done>=Math.max(1,Number(config.completionValue)||1);
  else if(mode==='percentage')threshold=(children.length?done/children.length*100:100)>=Math.max(0,Number(config.completionValue)||0);
  else if(mode==='manual'||mode==='open_ended')threshold=false;
  else threshold=requiredDone;
  return {done,total:children.length,required:required.length,requiredDone,percentage:children.length?Math.min(100,done/children.length*100):100,satisfied:requiredDone&&threshold,mode};
}
function maybeFinishRunfunction maybeFinishRun(s,run,at) {
  if(!isWorkingRun(run))return;
  if(run.type==='project')refreshProjectChildren(run,at);
  const progress=runProgress(run,s,at),config=run.blockSnapshot?.config||{},policy=config.afterMinimum||'auto_finish';
  run.completionPercentage=progress.percentage;if(run.type==='project')run.conditionResults=copy(progress.conditionResults||[]);
  if(progress.satisfied&&!run.minimumReachedAt)run.minimumReachedAt=iso(at);
  if(run.type==='project') {
    if(progress.satisfied) {
      if(!run.conditionsSatisfiedAt)run.conditionsSatisfiedAt=iso(at);
      const finish=config.finishBehavior||'ready_to_finish';
      if(finish==='auto_finish')finishRun(s,run,at);
      else run.status='READY_TO_FINISH';
    } else if(run.status==='READY_TO_FINISH')run.status=run.overdueAt?'OVERDUE':'IN_PROGRESS';
    return;
  }
  if(progress.satisfied&&(policy==='auto_finish'||progress.done===progress.total||run.type==='workflow'))finishRun(s,run,at);
}
function finishRun(s,run,at,manualSuccess=false) {
  if(!isWorkingRun(run))return;
  const end=run.type==='project'?iso(at):(run.deadlineAt&&run.deadlineAt<iso(at)?run.deadlineAt:iso(at));
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
  const progress=runProgress(run,s,at);run.completionPercentage=progress.percentage;if(run.type==='project')run.conditionResults=copy(progress.conditionResults||[]);
  run.status=manualSuccess||progress.satisfied?'COMPLETED':'MISSED';
  run.finishedAt=iso(at);record(s,`run_${run.status.toLowerCase()}`,{runId:run.id,blockId:run.blockId,completed:progress.done,required:progress.required},at);
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
    if(!last) {const begin=periodBounds(cadence,start,s.settings);last=createRun(s,block,at,begin,cadence);}
    let guard=0;
    while(last.deadlineAt&&last.deadlineAt<=iso(at)&&guard++<740) {
      finishRun(s,last,last.deadlineAt);
      const next=periodBounds(cadence,new Date(last.deadlineAt).getTime()+1000,s.settings);
      if(next.start>=current.end)break;
      last=createRun(s,block,new Date(next.start).getTime(),next,cadence);
    }
  }
}
function reconcileProjects(s,at) {
  const when=iso(at);
  for(const run of s.runs.filter(r=>r.type==='project'&&(isWorkingRun(r)||r.status==='BLOCKED'))) {
    refreshProjectChildren(run,at);
    if(run.status!=='BLOCKED')maybeFinishRun(s,run,at);
    if(!run.deadlineAt||run.deadlineAt>when||run.status==='COMPLETED')continue;
    if(!run.overdueAt){run.overdueAt=run.deadlineAt;record(s,'project_overdue',{runId:run.id,blockId:run.blockId},run.deadlineAt);}
    const cfg=run.blockSnapshot?.config||{},progress=runProgress(run,s,at);
    if((cfg.deadlinePolicy||'continue_overdue')==='expire_unfinished'&&!progress.satisfied) {
      for(const child of run.children)if(['OPEN','LOCKED','BLOCKED'].includes(child.status)){child.status='MISSED';child.resolvedAt=run.deadlineAt;}
      run.status='EXPIRED';run.finishedAt=run.deadlineAt;
      record(s,'project_expired',{runId:run.id,blockId:run.blockId,completed:progress.done},run.deadlineAt);
    } else if(run.status==='IN_PROGRESS')run.status='OVERDUE';
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
  s.occurrences.push(o);record(s,'occurrence_created',{occurrenceId:o.id,entryId:entry.id},at);
  updateOccurrenceStatus(s,at);return o;
}
function updateOccurrenceStatus(s,at) {
  for(const o of s.occurrences.filter(x=>x.status==='OPEN'&&x.deadlineAt<iso(at))) {
    const policy=o.entrySnapshot?.unfinished||'stay_overdue';
    if(policy==='expire') {o.status='MISSED';o.resolvedAt=o.deadlineAt;record(s,'occurrence_missed',{occurrenceId:o.id},at);}
    else o.status=policy==='carry_forward'?'CARRIED':'OVERDUE';
  }
}
function reconcileOccurrences(s,at,horizonDays=14) {
  const zone=s.settings.timezone||'Europe/London',today=localKey(at,zone);
  updateOccurrenceStatus(s,at);
  for(const block of s.blocks.filter(b=>b.type==='action_list'&&b.status!=='ARCHIVED'&&s.activations.some(a=>a.blockId===b.id&&a.status==='ACTIVE'))) {
    const activation=s.activations.find(a=>a.blockId===block.id&&a.status==='ACTIVE');
    for(const entry of block.entries||[]) {
      const earliest=[entry.activeFrom,entry.createdAt,activation?.startedAt,s.meta?.occurrenceFloorAt].filter(Boolean).map(x=>localKey(x,zone)).sort().at(-1)||today;
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
    const participants=(b.relationships||[]).map((r,index)=>({r,index,weight:Math.max(1,Math.min(20,Number(r.weight)||1)),score:0}));
    const slots=[],total=participants.reduce((n,p)=>n+p.weight,0);
    for(let n=0;n<total;n++) {
      for(const p of participants)p.score+=p.weight;
      participants.sort((a,b)=>b.score-a.score||a.index-b.index);
      const chosen=participants[0];chosen.score-=total;
      slots.push({relationshipId:chosen.r.id,refId:chosen.r.refId,kind:chosen.r.kind});
    }
    if(existing)existing.sequence=slots;
    else s.cycles.push({id:id('cycle'),blockId:b.id,sequence:slots,index:0,round:1,bigRound:1,createdAt:iso(at),history:[]});
  }
}
function resumeActivation(s,activation,at) {
  const resumeAt=activation.resumeAt&&activation.resumeAt<iso(at)?activation.resumeAt:iso(at);
  const pausedAt=activation.pausedAt||resumeAt,duration=Math.max(0,Date.parse(resumeAt)-Date.parse(pausedAt));
  const block=byId(s,'blocks',activation.blockId),cadence=activation.schedule?.period||block?.config?.period||'manual';
  const pausedRuns=s.runs.filter(r=>r.activationId===activation.id&&r.status==='PAUSED');
  for(const run of pausedRuns) {
    if(['daily','weekly'].includes(cadence)&&run.deadlineAt<=resumeAt)continue;
    run.status=run.statusBeforePause||'IN_PROGRESS';run.statusBeforePause=null;run.resumedAt=resumeAt;
    if(!['daily','weekly'].includes(cadence)) {
      if(run.deadlineAt)run.deadlineAt=iso(Date.parse(run.deadlineAt)+duration);
      for(const child of run.children){if(child.availableAt)child.availableAt=iso(Date.parse(child.availableAt)+duration);if(child.dueAt)child.dueAt=iso(Date.parse(child.dueAt)+duration);if(child.snoozedUntil)child.snoozedUntil=iso(Date.parse(child.snoozedUntil)+duration);}
    }
    run.transitions.push({id:id('transition'),event:'RUN_RESUMED',at:resumeAt,pauseDurationMinutes:duration/60000});
  }
  activation.status='ACTIVE';activation.resumedAt=resumeAt;activation.totalPausedMinutes=(activation.totalPausedMinutes||0)+duration/60000;
  activation.pausedAt=null;activation.resumeAt=null;
  if(block?.type==='routine'&&['daily','weekly'].includes(cadence)&&!s.runs.some(r=>r.activationId===activation.id&&r.status==='IN_PROGRESS')) {
    const bounds=periodBounds(cadence,resumeAt,s.settings);createRun(s,block,resumeAt,bounds,cadence);
  }
  record(s,'block_resumed',{blockId:activation.blockId,activationId:activation.id},resumeAt);
}
function reconcileActivations(s,at) {
  for(const activation of s.activations.filter(a=>a.status==='PAUSED'&&a.resumeAt&&a.resumeAt<=iso(at)))resumeActivation(s,activation,at);
}
export function reconcile(input,at) {
  const s=copy(input);validate(s);reconcileActivations(s,at);reconcileRoutines(s,at);reconcileOccurrences(s,at);reconcilePeriods(s,at);reconcileAvoid(s,at);reconcileProjects(s,at);ensureCycles(s,at);return s;
}
function eligibleActionContexts(s,actionId,at) {
  const when=iso(at),refs=[];
  for(const o of s.occurrences)if(o.itemSnapshot?.id===actionId&&['OPEN','OVERDUE','CARRIED'].includes(o.status)&&o.dueAt<=when)refs.push(o.id);
  for(const run of s.runs)if(isWorkingRun(run)&&run.startedAt<=when&&(run.type==='project'||!run.deadlineAt||when<run.deadlineAt))
    for(const child of run.children)if(child.kind==='Action'&&child.refId===actionId&&child.status==='OPEN'&&(!child.availableAt||child.availableAt<=when))refs.push(child.id);
  return [...new Set(refs)];
}
function addActionLog(s,command,at) {
  const a=byId(s,'actions',command.actionId);insist(a&&a.status!=='ARCHIVED','Action unavailable.');
  const quantity=command.quantity==null?(a.direction==='Avoid'?1:0):Number(command.quantity),durationMinutes=command.durationMinutes==null?0:Number(command.durationMinutes);
  insist(Number.isFinite(quantity)&&quantity>=0&&Number.isFinite(durationMinutes)&&durationMinutes>=0,'Invalid quantity or time.');
  const kind=a.completion?.type||'quantity';if(a.direction!=='Avoid')insist((kind==='time'?durationMinutes:quantity)>0,'Log a positive amount.');
  const results={};for(const f of a.resultFields||[])results[f.id]=resultValue(f,command.results?.[f.id],s);
  const occurredAt=command.occurredAt?iso(command.occurredAt):iso(at);
  insist(Date.parse(occurredAt)<=Number(at)+600000,'The Action time cannot be in the future.');
  const auto=eligibleActionContexts(s,a.id,at),contexts=[...new Set([...auto,...(command.contexts||[])])];
  for(const ref of contexts) {
    const occurrence=byId(s,'occurrences',ref),child=s.runs.flatMap(r=>r.children).find(c=>c.id===ref);
    insist(occurrence?.itemSnapshot?.id===a.id||child?.refId===a.id,`Context ${ref} does not belong to this Action.`);
  }
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
      maybeFinishRun(s,run,at);
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
  if(kind==='actions')for(const b of s.blocks) {for(const r of b.relationships||[])if(r.kind==='Action'&&r.refId===target)refs.push(b.name);for(const e of b.entries||[])if(e.kind==='Action'&&e.refId===target)refs.push(b.name);if(b.type==='project'&&(b.config?.conditions||[]).some(c=>c.type==='result'&&c.actionId===target))refs.push(`${b.name} completion condition`);}
  if(kind==='actions'){
    if(s.occurrences.some(o=>o.itemSnapshot?.id===target&&['OPEN','OVERDUE','CARRIED'].includes(o.status)))refs.push('open occurrence');
    if(s.runs.some(run=>run.status==='IN_PROGRESS'&&run.children.some(c=>c.kind==='Action'&&c.refId===target&&c.status==='OPEN')))refs.push('active Run');
  }
  if(kind==='blocks'){
    for(const b of s.blocks){for(const r of b.relationships||[])if(r.kind==='Block'&&r.refId===target)refs.push(b.name);if(b.type==='project'&&(b.config?.conditions||[]).some(c=>c.type==='target'&&c.targetBlockId===target))refs.push(`${b.name} completion condition`);}
    if(s.activations.some(a=>a.blockId===target&&a.status==='ACTIVE'))refs.push('active Block');
    if(s.runs.some(r=>r.blockId===target&&r.status==='IN_PROGRESS'))refs.push('active Run');
  }
  if(kind==='categories')for(const tag of s.tags)if(tag.categoryId===target)refs.push(tag.name);
  if(kind==='tags')for(const a of s.actions)if((a.tagIds||[]).includes(target))refs.push(a.name);
  if(kind==='units')for(const a of s.actions)if((a.resultFields||[]).some(r=>r.unitId===target))refs.push(a.name);
  return refs;
}
export function definitionImpact(s,kind,target) {
  const d=byId(s,kind,target);if(!d)return {references:[],historyCount:0,logs:0,runs:0,occurrences:0,periods:0};
  let logs=0,runs=0,occurrences=0,periods=0;
  if(kind==='actions') {
    logs=s.actionLogs.filter(x=>x.actionId===target).length;
    runs=s.runs.filter(x=>x.children?.some(c=>c.kind==='Action'&&c.refId===target)).length;
    occurrences=s.occurrences.filter(x=>x.itemSnapshot?.id===target).length;
    periods=s.periods.filter(x=>x.actionId===target).length;
  } else if(kind==='blocks') {
    runs=s.runs.filter(x=>x.blockId===target||x.children?.some(c=>c.kind==='Block'&&c.refId===target)).length;
    occurrences=s.occurrences.filter(x=>x.blockId===target).length;
    periods=s.periods.filter(x=>x.blockId===target).length;
  } else if(kind==='tags') {
    logs=s.actionLogs.filter(x=>(x.actionSnapshot?.tagIds||[]).includes(target)).length;
    runs=s.runs.filter(x=>x.children?.some(c=>(c.definitionSnapshot?.tagIds||[]).includes(target))).length;
  } else if(kind==='units') {
    logs=s.actionLogs.filter(x=>(x.resultSnapshots||[]).some(r=>r.unitId===target)||Object.values(x.results||{}).some(v=>v?.unitId===target)).length;
    runs=s.runs.filter(x=>x.children?.some(c=>(c.definitionSnapshot?.resultFields||[]).some(r=>r.unitId===target))).length;
  } else if(kind==='categories') {
    const tagIds=new Set(s.tags.filter(t=>t.categoryId===target).map(t=>t.id));
    logs=s.actionLogs.filter(x=>(x.actionSnapshot?.tagIds||[]).some(t=>tagIds.has(t))).length;
    runs=s.runs.filter(x=>x.children?.some(c=>(c.definitionSnapshot?.tagIds||[]).some(t=>tagIds.has(t)))).length;
  }
  return {references:[...new Set(dependencies(s,kind,target))],logs,runs,occurrences,periods,historyCount:logs+runs+occurrences+periods};
}
const clearCollections={actionLogs:'actionLogs',runs:'runs',occurrences:'occurrences',periods:'periods',cycles:'cycles',reviews:'reviews',history:'history'};
function recordInstant(key,record) {
  if(key==='actionLogs'||key==='reviews'||key==='history')return record.at;
  if(key==='runs')return record.startedAt||record.finishedAt;
  if(key==='occurrences')return record.dueAt||record.createdAt;
  if(key==='periods')return record.start||record.closedAt;
  if(key==='cycles')return record.createdAt;
  return null;
}
function clearMatches(key,record,options) {
  if(options.dateMode!=='before'||!options.cutoff)return true;
  const instant=recordInstant(key,record);return instant?instant<options.cutoff:false;
}
export function dataClearImpact(s,options={}) {
  const selected=new Set(options.categories||[]),counts={};let total=0;
  for(const [category,key] of Object.entries(clearCollections))if(selected.has(category)) {
    counts[category]=s[key].filter(x=>clearMatches(category,x,options)).length;total+=counts[category];
  }
  if(selected.has('settings')){counts.settings=1;total++;}
  return {counts,total,affectsTargets:(counts.actionLogs||0)>0,affectsRunHistory:(counts.runs||0)>0,affectsAnalysis:(counts.actionLogs||0)>0};
}
function addRestorePoint(s,reason,at) {
  const snapshot=copy(s);snapshot.restorePoints=[];
  const point={id:id('restore'),at:iso(at),reason,state:snapshot};s.restorePoints.push(point);return point;
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
    case 'EDIT_RELATIONSHIP':{
      const b=byId(s,'blocks',command.blockId),r=b?.relationships?.find(x=>x.id===command.relationshipId);insist(r,'Relationship not found.');
      Object.assign(r,{required:command.required!==false,weight:Math.max(1,Number(command.weight)||1),config:copy(command.config||{})});
      b.updatedAt=iso(at);record(s,'relationship_edited',{blockId:b.id,relationshipId:r.id},at);value=r;break;
    }
    case 'REMOVE_RELATIONSHIP':{
      const b=byId(s,'blocks',command.blockId),r=b?.relationships?.find(x=>x.id===command.relationshipId);insist(r,'Relationship not found.');
      b.relationships=b.relationships.filter(x=>x.id!==r.id);b.updatedAt=iso(at);record(s,'relationship_removed',{blockId:b.id,relationshipId:r.id},at);value=r;break;
    }
    case 'ADD_ENTRY':{
      const b=byId(s,'blocks',command.blockId);insist(b?.type==='action_list','Action List not found.');
      const e={id:id('entry'),kind:command.kind,refId:command.refId||null,name:command.name||'',schedule:copy(command.schedule||{mode:'manual'}),
        activeFrom:command.activeFrom||null,activeUntil:command.activeUntil||null,deadlineMinutes:command.deadlineMinutes??null,
        repeatEnd:command.repeatEnd||null,offPeriods:[],reminderMinutes:copy(command.reminderMinutes||[]),alarm:!!command.alarm,
        unfinished:command.unfinished||s.settings.defaults?.actionListUnfinished||'expire',overlap:command.overlap||'keep_each',status:'ACTIVE',paused:false,createdAt:iso(at),updatedAt:iso(at)};
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
    case 'PAUSE_BLOCK':{
      const activation=s.activations.find(x=>x.blockId===command.blockId&&x.status==='ACTIVE');insist(activation,'Active Block not found.');
      const resumeAt=iso(command.resumeAt);insist(resumeAt>iso(at),'Choose a future resume time.');
      activation.status='PAUSED';activation.pausedAt=iso(at);activation.resumeAt=resumeAt;
      for(const run of s.runs.filter(r=>r.activationId===activation.id&&(isWorkingRun(r)||r.status==='BLOCKED'))) {
        run.statusBeforePause=run.status;run.status='PAUSED';run.pausedAt=iso(at);run.transitions.push({id:id('transition'),event:'RUN_PAUSED',at:iso(at),resumeAt});
      }
      record(s,'block_paused',{blockId:activation.blockId,activationId:activation.id,resumeAt},at);value=activation;break;
    }
    case 'RESUME_BLOCK':{
      const activation=s.activations.find(x=>x.blockId===command.blockId&&x.status==='PAUSED');insist(activation,'Paused Block not found.');
      activation.resumeAt=iso(at);resumeActivation(s,activation,at);value=activation;break;
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
      const run=byId(s,'runs',command.runId),child=run?.children.find(c=>c.id===command.childId);insist(child&&isWorkingRun(run)&&child.status==='OPEN','Open Run child not found.');
      const allowed=run.type==='project'?['DONE','SKIPPED','EXCUSED','NOT_APPLICABLE']:['DONE','SKIPPED'];
      insist(allowed.includes(command.status),'Invalid child outcome.');child.status=command.status;child.resolvedAt=iso(at);child.notes=command.notes||'';
      advanceWorkflow(run,child,at);if(run.type==='project')refreshProjectChildren(run,at);maybeFinishRun(s,run,at);record(s,'run_child_resolved',{runId:run.id,childId:child.id,status:child.status},at);value=child;break;
    }
    case 'BLOCK_PROJECT_CHILD':{
      const run=byId(s,'runs',command.runId),child=run?.children.find(c=>c.id===command.childId);
      insist(run?.type==='project'&&isWorkingRun(run)&&child?.status==='OPEN','Open Project child not found.');
      child.status='BLOCKED';child.blockedAt=iso(at);child.blockedReason=String(command.reason||'');child.expectedUnblockAt=command.expectedUnblockAt?iso(command.expectedUnblockAt):null;
      record(s,'project_child_blocked',{runId:run.id,childId:child.id,reason:child.blockedReason},at);value=child;break;
    }
    case 'UNBLOCK_PROJECT_CHILD':{
      const run=byId(s,'runs',command.runId),child=run?.children.find(c=>c.id===command.childId);
      insist(run?.type==='project'&&child?.status==='BLOCKED','Blocked Project child not found.');
      child.status='OPEN';child.unblockedAt=iso(at);refreshProjectChildren(run,at);
      record(s,'project_child_unblocked',{runId:run.id,childId:child.id},at);value=child;break;
    }
    case 'BLOCK_PROJECT':{
      const run=byId(s,'runs',command.runId);insist(run?.type==='project'&&isWorkingRun(run),'Active Project Run not found.');
      run.statusBeforeBlocked=run.status;run.status='BLOCKED';run.blockedAt=iso(at);run.blockedReason=String(command.reason||'');run.expectedUnblockAt=command.expectedUnblockAt?iso(command.expectedUnblockAt):null;
      record(s,'project_blocked',{runId:run.id,blockId:run.blockId,reason:run.blockedReason},at);value=run;break;
    }
    case 'UNBLOCK_PROJECT':{
      const run=byId(s,'runs',command.runId);insist(run?.type==='project'&&run.status==='BLOCKED','Blocked Project Run not found.');
      run.status=run.statusBeforeBlocked||'IN_PROGRESS';run.statusBeforeBlocked=null;run.unblockedAt=iso(at);refreshProjectChildren(run,at);maybeFinishRun(s,run,at);
      record(s,'project_unblocked',{runId:run.id,blockId:run.blockId},at);value=run;break;
    }
    case 'CANCEL_RUN':{
      const run=byId(s,'runs',command.runId);insist(run?.type==='project'&&(isWorkingRun(run)||['BLOCKED','PAUSED'].includes(run.status)),'Active Project Run not found.');
      run.status='CANCELLED';run.finishedAt=iso(at);run.cancelReason=String(command.reason||'');record(s,'project_cancelled',{runId:run.id,blockId:run.blockId,reason:run.cancelReason},at);value=run;break;
    }
    case 'RETURN_STEP':{
      const run=byId(s,'runs',command.runId);insist(run?.type==='workflow'&&run.status==='IN_PROGRESS','Open Workflow Run not found.');
      const target=run.children.findIndex(x=>x.id===command.childId);insist(target>=0,'Step not found.');
      run.children.forEach((x,i)=>{if(i>target&&x.status==='OPEN')x.status='LOCKED';});
      run.children[target].status='OPEN';run.transitions.push({id:id('transition'),event:'RETURN_STEP',at:iso(at),to:command.childId});
      record(s,'workflow_returned',{runId:run.id,childId:command.childId},at);value=run;break;
    }
    case 'FINISH_RUN':{
      const run=byId(s,'runs',command.runId);insist(run,'Run not found.');
      if(run.type==='project') {
        const conditions=projectCompletionConditions(run),manual=conditions.some(c=>c.type==='manual');
        if(manual&&!run.manualConditionSatisfied){run.manualConditionSatisfied=true;record(s,'project_manual_condition_satisfied',{runId:run.id,blockId:run.blockId},at);}
        const progress=runProgress(run,s,at);run.conditionResults=copy(progress.conditionResults||[]);
        insist(isWorkingRun(run)&&(run.status==='READY_TO_FINISH'||progress.satisfied),'Project is not ready to finish.');
      }
      finishRun(s,run,at,true);value=run;break;
    }
    case 'RESOLVE_CYCLE':{
      const cycle=s.cycles.find(x=>x.blockId===command.blockId);insist(cycle&&cycle.sequence.length,'Cycle has no participants.');
      const slot=cycle.sequence[cycle.index];cycle.history.push({id:id('cycle_event'),at:iso(at),index:cycle.index,outcome:command.outcome,slot:copy(slot)});
      const block=byId(s,'blocks',cycle.blockId),policy=block?.config?.missedPolicy||s.settings.defaults?.cycleMissed||'keep_position';
      if(command.outcome==='COMPLETED'||command.outcome==='MISSED'&&policy==='skip_to_next')cycle.index++;
      if(command.outcome==='MISSED'&&policy==='restart')cycle.index=0;
      if(cycle.index>=cycle.sequence.length) {
        cycle.index=0;cycle.round++;
        const smallPerBig=Math.max(1,Number(block?.config?.smallCyclesPerBig)||1);
        cycle.bigRound=Math.floor((cycle.round-1)/smallPerBig)+1;
      }
      record(s,'cycle_resolved',{blockId:cycle.blockId,outcome:command.outcome,position:cycle.index},at);value=cycle;break;
    }
    case 'ADD_REVIEW':value={id:id('review'),at:iso(at),period:command.period||'week',notes:String(command.notes||''),highlights:String(command.highlights||''),next:String(command.next||'')};s.reviews.push(value);record(s,'review_saved',{reviewId:value.id},at);break;
    case 'SET_SETTINGS':s.settings={...s.settings,...copy(command.changes)};record(s,'settings_changed',{keys:Object.keys(command.changes)},at);break;
    case 'CLEAR_DATA':{
      const options={categories:copy(command.categories||[]),dateMode:command.dateMode||'all',cutoff:command.cutoff?iso(command.cutoff):null};
      const impact=dataClearImpact(s,options);insist(impact.total>0,'No matching data to clear.');addRestorePoint(s,'before clearing selected data',at);
      const selected=new Set(options.categories);
      if(selected.has('actionLogs')) {
        const removed=new Set(s.actionLogs.filter(x=>clearMatches('actionLogs',x,options)).map(x=>x.id));
        s.actionLogs=s.actionLogs.filter(x=>!removed.has(x.id));
        for(const o of s.occurrences)if(removed.has(o.actionLogId))o.actionLogId=null;
        for(const run of s.runs)for(const child of run.children||[]) {
          child.actionLogIds=(child.actionLogIds||[]).filter(x=>!removed.has(x));
          if(removed.has(child.actionLogId))child.actionLogId=child.actionLogIds.at(-1)||null;
        }
      }
      for(const category of ['runs','occurrences','periods','cycles','reviews','history'])if(selected.has(category))
        s[clearCollections[category]]=s[clearCollections[category]].filter(x=>!clearMatches(category,x,options));
      if(selected.has('runs'))for(const activation of s.activations.filter(x=>x.status==='ACTIVE'))
        if(!s.runs.some(r=>r.activationId===activation.id&&r.status==='IN_PROGRESS'))activation.startedAt=iso(at);
      if(selected.has('occurrences')) {
        const floor=options.dateMode==='before'&&options.cutoff?options.cutoff:iso(at);
        if(!s.meta.occurrenceFloorAt||s.meta.occurrenceFloorAt<floor)s.meta.occurrenceFloorAt=floor;
      }
      if(selected.has('settings'))s.settings=copy(emptyState().settings);
      record(s,'data_cleared',{counts:impact.counts,dateMode:options.dateMode,cutoff:options.cutoff},at);value=impact;break;
    }
    case 'ARCHIVE':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');d.status='ARCHIVED';d.updatedAt=iso(at);
      if(command.kind==='blocks'){
        const a=s.activations.find(x=>x.blockId===d.id&&x.status==='ACTIVE');if(a)a.status='INACTIVE';
        for(const run of s.runs.filter(x=>x.blockId===d.id&&x.status==='IN_PROGRESS'))finishRun(s,run,at);
      }
      record(s,'definition_archived',{kind:command.kind,definitionId:d.id},at);value=d;break;
    }
    case 'UNARCHIVE':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');d.status='ACTIVE';d.updatedAt=iso(at);
      record(s,'definition_unarchived',{kind:command.kind,definitionId:d.id},at);value=d;break;
    }
    case 'BULK_ARCHIVE':case 'BULK_UNARCHIVE':{
      const items=copy(command.items||[]);insist(items.length&&items.length<=500,'Choose between 1 and 500 definitions.');
      const defs=items.map(item=>{insist(['categories','tags','units','actions','blocks'].includes(item.kind),'Invalid definition type.');const d=byId(s,item.kind,item.id);insist(d,'Definition not found.');return {...item,d};});
      const archived=command.type==='BULK_ARCHIVE';
      for(const {kind,d} of defs) {
        d.status=archived?'ARCHIVED':'ACTIVE';d.updatedAt=iso(at);
        if(archived&&kind==='blocks') {
          const activation=s.activations.find(x=>x.blockId===d.id&&x.status==='ACTIVE');if(activation)activation.status='INACTIVE';
          for(const run of s.runs.filter(x=>x.blockId===d.id&&x.status==='IN_PROGRESS'))finishRun(s,run,at);
        }
        record(s,archived?'definition_archived':'definition_unarchived',{kind,definitionId:d.id},at);
      }
      value=defs.map(x=>x.d);break;
    }
    case 'BIN':{
      const d=byId(s,command.kind,command.id);insist(d,'Definition not found.');const dep=dependencies(s,command.kind,d.id);
      insist(!dep.length,`Used by: ${dep.join(', ')}`);
      s[command.kind]=s[command.kind].filter(x=>x.id!==d.id);const item={id:id('bin'),kind:command.kind,originalId:d.id,snapshot:copy(d),deletedAt:iso(at)};
      s.bin.push(item);record(s,'definition_binned',{kind:command.kind,definitionId:d.id,binId:item.id},at);value=item;break;
    }
    case 'BULK_BIN':{
      const items=copy(command.items||[]);insist(items.length&&items.length<=500,'Choose between 1 and 500 definitions.');
      const defs=items.map(item=>{insist(['categories','tags','units','actions','blocks'].includes(item.kind),'Invalid definition type.');const d=byId(s,item.kind,item.id);insist(d,'Definition not found.');return {...item,d,refs:dependencies(s,item.kind,item.id)};});
      const blocked=defs.filter(x=>x.refs.length);insist(!blocked.length,`Still used: ${blocked.map(x=>`${x.d.name} (${x.refs.join(', ')})`).join('; ')}`);
      value=[];for(const {kind,d} of defs) {
        s[kind]=s[kind].filter(x=>x.id!==d.id);const item={id:id('bin'),kind,originalId:d.id,snapshot:copy(d),deletedAt:iso(at)};
        s.bin.push(item);record(s,'definition_binned',{kind,definitionId:d.id,binId:item.id},at);value.push(item);
      }
      break;
    }
    case 'RESTORE':{
      const item=byId(s,'bin',command.binId);insist(item,'Bin item not found.');insist(!byId(s,item.kind,item.originalId),'Cannot restore conflicting ID.');
      s[item.kind].push(copy(item.snapshot));s.bin=s.bin.filter(x=>x.id!==item.id);record(s,'definition_restored',{kind:item.kind,definitionId:item.originalId},at);value=item.snapshot;break;
    }
    case 'BULK_RESTORE':{
      const ids=new Set(command.binIds||[]),items=s.bin.filter(x=>ids.has(x.id));insist(items.length===ids.size&&items.length,'Bin selection is no longer available.');
      for(const item of items)insist(!byId(s,item.kind,item.originalId),`Cannot restore ${item.snapshot.name}: its stable ID is already in use.`);
      for(const item of items){s[item.kind].push(copy(item.snapshot));record(s,'definition_restored',{kind:item.kind,definitionId:item.originalId},at);}
      s.bin=s.bin.filter(x=>!ids.has(x.id));value=items.map(x=>x.snapshot);break;
    }
    case 'PERMANENT_DELETE':{
      const item=byId(s,'bin',command.binId);insist(item,'Bin item not found.');addRestorePoint(s,`before permanently deleting ${item.snapshot.name}`,at);s.bin=s.bin.filter(x=>x.id!==item.id);
      record(s,'definition_deleted',{kind:item.kind,definitionId:item.originalId,displayName:item.snapshot.name},at);break;
    }
    case 'BULK_PERMANENT_DELETE':{
      const ids=new Set(command.binIds||[]),items=s.bin.filter(x=>ids.has(x.id));insist(items.length===ids.size&&items.length,'Bin selection is no longer available.');
      addRestorePoint(s,`before permanently deleting ${items.length} Bin items`,at);
      for(const item of items)record(s,'definition_deleted',{kind:item.kind,definitionId:item.originalId,displayName:item.snapshot.name},at);
      s.bin=s.bin.filter(x=>!ids.has(x.id));value=items.length;break;
    }
    case 'EMPTY_BIN':{
      if(s.bin.length)addRestorePoint(s,'before emptying Bin',at);
      for(const item of s.bin)record(s,'definition_deleted',{kind:item.kind,definitionId:item.originalId,displayName:item.snapshot.name},at);
      value=s.bin.length;s.bin=[];break;
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
  const upcoming=open.filter(x=>x.dueAt>date).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,8);
  const cycle=s.cycles.map(c=>{const slot=c.sequence[c.index],block=byId(s,'blocks',c.blockId);if(!slot||!block)return null;return {kind:'cycle',blockId:block.id,blockSnapshot:copy(block),itemSnapshot:copy(byId(s,slot.kind==='Action'?'actions':'blocks',slot.refId)),cycleId:c.id};}).find(Boolean);
  const target=s.periods.filter(p=>p.status==='OPEN'&&p.blockId).sort((a,b)=>a.end.localeCompare(b.end))[0];
  return {now:s.runs.find(x=>x.status==='IN_PROGRESS')||due[0]||cycle||(target?{kind:'target',blockSnapshot:target.blockSnapshot,period:target}:null)||upcoming[0]||null,due,avoid:s.actions.filter(x=>x.direction==='Avoid'),
    today:open.filter(x=>localKey(x.dueAt,s.settings.timezone)===today),
    week:open.filter(x=>x.dueAt>=week.start&&x.dueAt<week.end),
    project:s.runs.find(x=>x.type==='project'&&['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'].includes(x.status)&&x.blockSnapshot?.config?.primary)||s.runs.find(x=>x.type==='project'&&['IN_PROGRESS','READY_TO_FINISH','OVERDUE','BLOCKED','PAUSED'].includes(x.status))||null,
    upcoming};
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
  for(const run of s.runs.filter(x=>isWorkingRun(x)))for(const child of run.children||[]) {
    if(child.status!=='OPEN'||!child.dueAt)continue;
    const config=child.config||{},title=child.definitionSnapshot?.name||'SAMT reminder',due=Date.parse(child.dueAt);
    for(const minutes of config.reminderMinutes||[]) {
      const when=due-Number(minutes)*60000;
      if(when>current)items.push({id:`${child.id}:${minutes}`,at:when,title,body:`Upcoming in ${run.blockSnapshot?.name||'SAMT'}`,kind:'reminder'});
    }
    const alarmTime=child.snoozedUntil?Date.parse(child.snoozedUntil):due;
    if(config.alarm&&alarmTime>current)items.push({id:`${child.id}:alarm`,at:alarmTime,title,body:`Due in ${run.blockSnapshot?.name||'SAMT'}`,kind:'alarm'});
  }
  return items.sort((a,b)=>a.at-b.at).slice(0,250);
}
export function backup(s,at) {validate(s);return JSON.stringify({format:'samt-android-backup',schemaVersion:VERSION,exportedAt:iso(at),state:s},null,2);}
export function importBackup(data) {
  const packageData=typeof data==='string'?JSON.parse(data):copy(data);
  insist(packageData?.format==='samt-android-backup'&&packageData.schemaVersion===VERSION,'Unsupported backup format.');
  const candidate=copy(packageData.state);validate(candidate);return candidate;
}
