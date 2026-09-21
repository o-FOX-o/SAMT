import assert from 'node:assert/strict';
import {emptyState,execute,reconcile,periodBounds,home,overview,backup,importBackup,validate,alarmRequests} from '../web/engine.js';

const at=(s)=>Date.parse(s);
const issue=(state,type,when,other={})=>execute(state,{type,...other},at(when));
const t0='2026-03-28T12:00:00Z';
let state=emptyState();
let result=issue(state,'ADD_DEFINITION',t0,{kind:'categories',data:{name:'Health'}});state=result.state;
result=issue(state,'ADD_DEFINITION',t0,{kind:'tags',data:{name:'Exercise',categoryId:result.value.id}});state=result.state;const tag=result.value;
result=issue(state,'ADD_DEFINITION',t0,{kind:'actions',data:{name:'Train',tagIds:[tag.id],completion:{type:'time',minimumMinutes:30},resultFields:[{id:'effort',type:'score',label:'Effort',minimum:0,maximum:10,required:true}]}});state=result.state;const action=result.value;
result=issue(state,'ADD_DEFINITION',t0,{kind:'blocks',data:{name:'Daily Health',type:'routine',config:{period:'daily'}}});state=result.state;const routine=result.value;
result=issue(state,'ADD_RELATIONSHIP',t0,{blockId:routine.id,kind:'Action',refId:action.id});state=result.state;
result=issue(state,'ACTIVATE',t0,{blockId:routine.id,schedule:{period:'daily'}});state=result.state;
state=reconcile(state,at(t0));const run=state.runs[0];
assert.equal(run.deadlineAt,'2026-03-29T00:00:00.000Z');
assert.equal(periodBounds('daily',at('2026-03-29T12:00:00Z')).end,'2026-03-29T23:00:00.000Z','DST day has 23 hours');
// Snapshot must survive definition edits.
state=issue(state,'EDIT_DEFINITION',t0,{kind:'blocks',id:routine.id,changes:{name:'Renamed Health'}}).state;
assert.equal(run.blockSnapshot.name,'Daily Health');
assert.equal(state.runs[0].blockSnapshot.name,'Daily Health');
state=reconcile(state,at('2026-03-30T00:02:00Z'));
assert.equal(state.runs[0].status,'MISSED');
assert.equal(state.runs[1].status,'MISSED');
assert.equal(state.runs[2].status,'IN_PROGRESS');
assert.equal(state.runs[2].startedAt,'2026-03-29T23:00:00.000Z');

result=issue(state,'ADD_DEFINITION','2026-03-30T07:00:00Z',{kind:'blocks',data:{name:'Daily List',type:'action_list'}});state=result.state;const list=result.value;
result=issue(state,'ADD_ENTRY','2026-03-30T07:00:00Z',{blockId:list.id,kind:'Todo',name:'Pack bag',schedule:{mode:'daily',time:'10:00'},reminderMinutes:[30],alarm:true});state=result.state;const todo=result.value;
result=issue(state,'ADD_ENTRY','2026-03-30T07:00:00Z',{blockId:list.id,kind:'Action',refId:action.id,schedule:{mode:'daily',time:'10:00'}});state=result.state;const listedAction=result.value;
state=issue(state,'ACTIVATE','2026-03-30T07:00:00Z',{blockId:list.id}).state;
state=reconcile(state,at('2026-03-30T07:10:00Z'));assert.ok(state.occurrences.length>0);
const occ=state.occurrences.find(o=>o.entryId===todo.id&&o.dueAt==='2026-03-30T09:00:00.000Z');assert.ok(occ);
assert.ok(alarmRequests(state,at('2026-03-30T07:10:00Z')).some(x=>x.id===`${occ.id}:alarm`));
state=issue(state,'COMPLETE_TODO','2026-03-30T09:01:00Z',{occurrenceId:occ.id}).state;
assert.equal(state.actionLogs.length,0,'Todo does not create factual Action Log');
const catchUp=reconcile(state,at('2026-04-04T13:00:00Z'));
assert.ok(catchUp.occurrences.some(o=>o.entryId===todo.id&&o.dueAt==='2026-04-02T09:00:00.000Z'),'past scheduled occurrences catch up after days away');

let manual=issue(emptyState(),'ADD_DEFINITION',t0,{kind:'blocks',data:{name:'Manual errands',type:'action_list'}});
let manualState=manual.state,manualList=manual.value;
manual=issue(manualState,'ADD_ENTRY',t0,{blockId:manualList.id,kind:'Todo',name:'Visit library',schedule:{mode:'manual'}});
manualState=manual.state;const manualEntry=manual.value;
manualState=issue(manualState,'ACTIVATE',t0,{blockId:manualList.id}).state;
manualState=issue(manualState,'START_MANUAL_OCCURRENCE',t0,{blockId:manualList.id,entryId:manualEntry.id}).state;
assert.equal(manualState.occurrences.length,1);
manualState=issue(manualState,'PAUSE_ENTRY','2026-03-28T12:01:00Z',{blockId:manualList.id,entryId:manualEntry.id,paused:true}).state;
assert.throws(()=>issue(manualState,'START_MANUAL_OCCURRENCE','2026-03-28T12:02:00Z',{blockId:manualList.id,entryId:manualEntry.id}),/unavailable/);

// An Action Log is one record even when it contributes to two contexts.
const current=state.runs.find(r=>r.status==='IN_PROGRESS');
const actionOccurrence=state.occurrences.find(o=>o.entryId===listedAction.id&&o.dueAt==='2026-03-30T09:00:00.000Z');assert.ok(actionOccurrence);
result=issue(state,'LOG_ACTION','2026-03-30T09:03:00Z',{actionId:action.id,durationMinutes:45,results:{effort:8}});state=result.state;
assert.equal(state.actionLogs.length,1);
assert.deepEqual(new Set(state.actionLogs[0].contexts),new Set([current.children[0].id,actionOccurrence.id]),'eligible contexts resolve automatically');
assert.equal(state.occurrences.find(o=>o.id===actionOccurrence.id).status,'COMPLETED');
assert.equal(overview(state).uniqueMinutes,45);
state=issue(state,'LOG_ACTION','2026-03-30T09:07:00Z',{actionId:action.id,durationMinutes:31,results:{effort:6},occurredAt:'2026-03-30T06:00:00Z'}).state;
assert.equal(state.actionLogs.at(-1).at,'2026-03-30T06:00:00.000Z','actual occurrence time survives logging later');
assert.equal(state.actionLogs.at(-1).recordedAt,'2026-03-30T09:07:00.000Z');
assert.equal(current.blockSnapshot.name,'Renamed Health');
assert.equal(state.runs[0].blockSnapshot.name,'Daily Health');
assert.equal(state.runs.find(r=>r.id===current.id).children[0].status,'DONE');
assert.throws(()=>issue(state,'LOG_ACTION','2026-03-30T09:04:00Z',{actionId:action.id,durationMinutes:1,results:{effort:11}}),/maximum/);

result=issue(state,'ADD_DEFINITION','2026-03-30T10:00:00Z',{kind:'blocks',data:{name:'Rotation',type:'cycle'}});state=result.state;const cycle=result.value;
state=issue(state,'ADD_RELATIONSHIP','2026-03-30T10:00:00Z',{blockId:cycle.id,kind:'Action',refId:action.id}).state;
state=issue(state,'ACTIVATE','2026-03-30T10:00:00Z',{blockId:cycle.id}).state;
state=reconcile(state,at('2026-03-30T10:01:00Z'));
state=issue(state,'RESOLVE_CYCLE','2026-03-30T10:02:00Z',{blockId:cycle.id,outcome:'MISSED'}).state;
assert.equal(state.cycles.find(x=>x.blockId===cycle.id).index,0,'missed cycle holds position');

const saved=backup(state,at('2026-03-30T11:00:00Z'));
assert.deepEqual(importBackup(saved),state);
const corrupted=JSON.parse(saved);corrupted.state.blocks[0].relationships[0].refId='missing';
assert.throws(()=>importBackup(corrupted),/Missing child/);
validate(state);
assert.ok(home(state,at('2026-03-30T11:00:00Z')).now);

let fresh=emptyState();
result=issue(fresh,'ADD_DEFINITION','2026-06-01T09:00:00Z',{kind:'actions',data:{name:'No scrolling',direction:'Avoid',completion:{type:'quantity',target:0},avoid:{mode:'binary_limit',limit:0,period:'daily'}}});fresh=result.state;const avoid=result.value;
fresh=reconcile(fresh,at('2026-06-02T08:00:00Z'));
assert.equal(fresh.periods.find(x=>x.actionId===avoid.id).status,'SUCCESS','clean Avoid day succeeds without a fake log');
assert.equal(fresh.actionLogs.length,0);

result=issue(fresh,'ADD_DEFINITION','2026-06-02T09:00:00Z',{kind:'actions',data:{name:'Draft',completion:{type:'quantity',target:1}}});fresh=result.state;const draft=result.value;
result=issue(fresh,'ADD_DEFINITION','2026-06-02T09:00:00Z',{kind:'actions',data:{name:'Publish',completion:{type:'quantity',target:1}}});fresh=result.state;const publish=result.value;
result=issue(fresh,'ADD_DEFINITION','2026-06-02T09:00:00Z',{kind:'blocks',data:{name:'Write article',type:'workflow'}});fresh=result.state;const flow=result.value;
fresh=issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:00:00Z',{blockId:flow.id,kind:'Action',refId:draft.id}).state;
assert.throws(()=>issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:00:00Z',{blockId:flow.id,kind:'Action',refId:draft.id}),/same Action/);
fresh=issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:00:00Z',{blockId:flow.id,kind:'Action',refId:publish.id}).state;
fresh=issue(fresh,'RUN_NOW','2026-06-02T09:00:00Z',{blockId:flow.id}).state;
let workflow=fresh.runs.find(x=>x.blockId===flow.id);
assert.equal(workflow.children[1].status,'LOCKED');
fresh=issue(fresh,'LOG_ACTION','2026-06-02T09:01:00Z',{actionId:draft.id,quantity:1}).state;
workflow=fresh.runs.find(x=>x.blockId===flow.id);
assert.equal(workflow.children[1].status,'OPEN','workflow unlocks next step');
fresh=issue(fresh,'RETURN_STEP','2026-06-02T09:02:00Z',{runId:workflow.id,childId:workflow.children[0].id}).state;
assert.equal(fresh.runs.find(x=>x.id===workflow.id).children[1].status,'LOCKED');

result=issue(fresh,'ADD_DEFINITION','2026-06-02T09:04:00Z',{kind:'blocks',data:{name:'Read more',type:'target',config:{period:'daily',metric:'count',target:2}}});fresh=result.state;const target=result.value;
fresh=issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:04:00Z',{blockId:target.id,kind:'Action',refId:draft.id}).state;
fresh=issue(fresh,'ACTIVATE','2026-06-02T09:04:00Z',{blockId:target.id}).state;
fresh=issue(fresh,'LOG_ACTION','2026-06-02T09:05:00Z',{actionId:draft.id,quantity:1}).state;
fresh=issue(fresh,'LOG_ACTION','2026-06-02T09:06:00Z',{actionId:draft.id,quantity:1}).state;
fresh=reconcile(fresh,at('2026-06-02T09:07:00Z'));
assert.equal(fresh.periods.find(p=>p.blockId===target.id).actual,3,'target counts unique relevant factual logs');
let starters=issue(emptyState(),'ADD_STARTER','2026-06-01T09:00:00Z',{which:'religion'}).state;
assert.equal(starters.runs.filter(r=>r.type==='routine'&&r.status==='IN_PROGRESS').length,2);
const prayer=starters.blocks.find(b=>b.templateKey==='religion_prayer');
const dhuhrChild=starters.runs.find(r=>r.blockId===prayer.id).children.find(c=>c.definitionSnapshot.name==='Dhuhr');
assert.equal(dhuhrChild.required,true);
assert.equal(starters.blocks.find(b=>b.templateKey==='religion').relationships.find(r=>starters.actions.find(a=>a.id===r.refId)?.name==='Jumu’ah').required,false);
const prayerAction=starters.actions.find(a=>a.name==='Dhuhr');
starters=issue(starters,'LOG_ACTION','2026-06-01T12:15:00Z',{actionId:prayerAction.id,quantity:1,results:{[prayerAction.resultFields[0].id]:8},contexts:[dhuhrChild.id]}).state;
assert.equal(starters.runs.find(r=>r.blockId===prayer.id).children.find(c=>c.id===dhuhrChild.id).status,'DONE');
starters=issue(starters,'ADD_STARTER','2026-06-01T12:16:00Z',{which:'hygiene'}).state;
const hygiene=starters.blocks.find(b=>b.templateKey==='hygiene_daily');
const hygieneRun=starters.runs.find(r=>r.blockId===hygiene.id),brush=hygieneRun.children.find(c=>c.definitionSnapshot.name==='Brush teeth');
const brushAction=starters.actions.find(a=>a.name==='Brush teeth');
starters=issue(starters,'LOG_ACTION','2026-06-01T12:17:00Z',{actionId:brushAction.id,quantity:1,contexts:[brush.id]}).state;
assert.equal(starters.runs.find(r=>r.id===hygieneRun.id).children.find(c=>c.id===brush.id).status,'OPEN','one brush is short of two');
starters=issue(starters,'LOG_ACTION','2026-06-01T21:00:00Z',{actionId:brushAction.id,quantity:1,contexts:[brush.id]}).state;
assert.equal(starters.runs.find(r=>r.id===hygieneRun.id).children.find(c=>c.id===brush.id).status,'DONE');
assert.throws(()=>issue(starters,'ADD_STARTER','2026-06-01T21:01:00Z',{which:'hygiene'}),/already exists/);
let nested=emptyState();
let add=issue(nested,'ADD_DEFINITION','2026-06-01T08:00:00Z',{kind:'blocks',data:{name:'Daily inner',type:'routine',config:{period:'daily'}}});nested=add.state;const inner=add.value;
add=issue(nested,'ADD_DEFINITION','2026-06-01T08:00:00Z',{kind:'blocks',data:{name:'Weekly outer',type:'routine',config:{period:'weekly'}}});nested=add.state;const outer=add.value;
nested=issue(nested,'ADD_RELATIONSHIP','2026-06-01T08:00:00Z',{blockId:outer.id,kind:'Block',refId:inner.id}).state;
nested=issue(nested,'ACTIVATE','2026-06-01T08:00:00Z',{blockId:outer.id,schedule:{period:'weekly'}}).state;
nested=issue(nested,'ACTIVATE','2026-06-01T08:01:00Z',{blockId:inner.id,schedule:{period:'daily'}}).state;
nested=reconcile(nested,at('2026-06-08T00:01:00Z'));
assert.equal(nested.runs.find(r=>r.blockId===outer.id).status,'COMPLETED','weekly parent follows seven closed daily Runs');
let avoiding=emptyState();
add=issue(avoiding,'ADD_DEFINITION','2026-06-01T08:00:00Z',{kind:'actions',data:{name:'Avoid distraction',direction:'Avoid',completion:{type:'quantity',target:0},avoid:{limit:0,period:'daily'}}});avoiding=add.state;const avoidAction=add.value;
add=issue(avoiding,'ADD_DEFINITION','2026-06-01T08:00:00Z',{kind:'blocks',data:{name:'What not to do',type:'routine',config:{period:'daily'}}});avoiding=add.state;const avoidRoutine=add.value;
avoiding=issue(avoiding,'ADD_RELATIONSHIP','2026-06-01T08:00:00Z',{blockId:avoidRoutine.id,kind:'Action',refId:avoidAction.id}).state;
avoiding=issue(avoiding,'ACTIVATE','2026-06-01T08:00:00Z',{blockId:avoidRoutine.id,schedule:{period:'daily'}}).state;
avoiding=reconcile(avoiding,at('2026-06-02T00:01:00Z'));
assert.equal(avoiding.runs[0].status,'COMPLETED','zero violations completes an Avoid routine without a log');
avoiding=issue(avoiding,'LOG_ACTION','2026-06-02T09:00:00Z',{actionId:avoidAction.id,quantity:1}).state;
avoiding=reconcile(avoiding,at('2026-06-03T00:01:00Z'));
assert.equal(avoiding.runs[1].status,'MISSED','a violation fails the required Avoid child');

let rules=emptyState(),made=[];
for(const name of ['One','Two','Three']){const next=issue(rules,'ADD_DEFINITION','2026-07-01T09:00:00Z',{kind:'actions',data:{name,completion:{type:'quantity',target:1}}});rules=next.state;made.push(next.value);}
add=issue(rules,'ADD_DEFINITION','2026-07-01T09:00:00Z',{kind:'blocks',data:{name:'Flexible Routine',type:'routine',config:{completionMode:'count',completionValue:2,afterMinimum:'allow_extra'}}});rules=add.state;const flexible=add.value;
for(const [index,a] of made.entries())rules=issue(rules,'ADD_RELATIONSHIP','2026-07-01T09:00:00Z',{blockId:flexible.id,kind:'Action',refId:a.id,required:index===0}).state;
rules=issue(rules,'RUN_NOW','2026-07-01T09:00:00Z',{blockId:flexible.id}).state;let flexRun=rules.runs.find(r=>r.blockId===flexible.id);
rules=issue(rules,'LOG_ACTION','2026-07-01T09:01:00Z',{actionId:made[1].id,quantity:1}).state;
assert.equal(rules.runs.find(r=>r.id===flexRun.id).minimumReachedAt,undefined,'count alone cannot bypass required children');
rules=issue(rules,'LOG_ACTION','2026-07-01T09:02:00Z',{actionId:made[0].id,quantity:1}).state;flexRun=rules.runs.find(r=>r.id===flexRun.id);
assert.ok(flexRun.minimumReachedAt);assert.equal(flexRun.status,'IN_PROGRESS','allow-extra keeps a satisfied Run open');
rules=issue(rules,'FINISH_RUN','2026-07-01T09:03:00Z',{runId:flexRun.id}).state;assert.equal(rules.runs.find(r=>r.id===flexRun.id).status,'COMPLETED');

let tree=emptyState(),treeBlocks=[];
for(const name of ['Root','Left','Right','Shared']){const next=issue(tree,'ADD_DEFINITION','2026-07-01T10:00:00Z',{kind:'blocks',data:{name,type:'collection'}});tree=next.state;treeBlocks.push(next.value);}
tree=issue(tree,'ADD_RELATIONSHIP','2026-07-01T10:01:00Z',{blockId:treeBlocks[0].id,kind:'Block',refId:treeBlocks[1].id}).state;
tree=issue(tree,'ADD_RELATIONSHIP','2026-07-01T10:02:00Z',{blockId:treeBlocks[0].id,kind:'Block',refId:treeBlocks[2].id}).state;
tree=issue(tree,'ADD_RELATIONSHIP','2026-07-01T10:03:00Z',{blockId:treeBlocks[1].id,kind:'Block',refId:treeBlocks[3].id}).state;
assert.throws(()=>issue(tree,'ADD_RELATIONSHIP','2026-07-01T10:04:00Z',{blockId:treeBlocks[2].id,kind:'Block',refId:treeBlocks[3].id}),/already exists at/);
assert.throws(()=>issue(tree,'ADD_RELATIONSHIP','2026-07-01T10:04:00Z',{blockId:treeBlocks[3].id,kind:'Block',refId:treeBlocks[0].id}),/Circular/);

let fair=emptyState();
for(const name of ['Chest','Legs']){const next=issue(fair,'ADD_DEFINITION','2026-07-01T11:00:00Z',{kind:'actions',data:{name,completion:{type:'quantity',target:1}}});fair=next.state;made[name==='Chest'?0:1]=next.value;}
add=issue(fair,'ADD_DEFINITION','2026-07-01T11:00:00Z',{kind:'blocks',data:{name:'Training rotation',type:'cycle',config:{smallCyclesPerBig:2}}});fair=add.state;const fairCycle=add.value;
fair=issue(fair,'ADD_RELATIONSHIP','2026-07-01T11:00:00Z',{blockId:fairCycle.id,kind:'Action',refId:made[0].id,weight:4}).state;
fair=issue(fair,'ADD_RELATIONSHIP','2026-07-01T11:00:00Z',{blockId:fairCycle.id,kind:'Action',refId:made[1].id,weight:1}).state;
fair=issue(fair,'ACTIVATE','2026-07-01T11:00:00Z',{blockId:fairCycle.id}).state;
const sequence=fair.cycles[0].sequence.map(x=>fair.actions.find(a=>a.id===x.refId).name);
assert.deepEqual(sequence,['Chest','Chest','Legs','Chest','Chest'],'weighted Cycle positions are spread deterministically');

let pauses=emptyState();
add=issue(pauses,'ADD_DEFINITION','2026-07-01T08:00:00Z',{kind:'blocks',data:{name:'Paused daily',type:'routine',config:{period:'daily'}}});pauses=add.state;const pausedDaily=add.value;
pauses=issue(pauses,'ACTIVATE','2026-07-01T08:00:00Z',{blockId:pausedDaily.id,schedule:{period:'daily'}}).state;
pauses=issue(pauses,'PAUSE_BLOCK','2026-07-01T20:00:00Z',{blockId:pausedDaily.id,resumeAt:'2026-07-02T12:00:00Z'}).state;
assert.equal(pauses.runs[0].status,'PAUSED');
pauses=reconcile(pauses,at('2026-07-02T13:00:00Z'));
assert.equal(pauses.runs[0].status,'PAUSED','paused calendar Run remains factual and is not marked missed');
assert.equal(pauses.runs.filter(r=>r.status==='MISSED').length,0);
assert.equal(pauses.runs.at(-1).status,'IN_PROGRESS');
assert.equal(pauses.activations[0].status,'ACTIVE');
console.log('PASS: snapshots, DST rollover, missed routines, Action/Todo distinction, one log across contexts, Results, cycles, alarms, Avoid zero periods, Workflow, Target and atomic backups');
