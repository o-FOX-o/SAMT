import assert from 'node:assert/strict';
import {emptyState,execute,reconcile,periodBounds,home,overview,backup,importBackup,validate,alarmRequests,definitionImpact,dataClearImpact} from '../web/engine.js';
import {LAYOUTS,TYPOGRAPHIES,PALETTES,FULL_PRESETS,visualSettings,resolvedAppearance,applyVisual,presetFromSettings,parseStylePreset,contrast} from '../web/visual.js';

const at=(s)=>Date.parse(s);
const issue=(state,type,when,other={})=>execute(state,{type,...other},at(when));
const t0='2026-03-28T12:00:00Z';
let state=emptyState();
let result=issue(state,'ADD_DEFINITION',t0,{kind:'categories',data:{name:'Health'}});state=result.state;
result=issue(state,'ADD_DEFINITION',t0,{kind:'tags',data:{name:'Exercise',categoryId:result.value.id}});state=result.state;const tag=result.value;
result=issue(state,'ADD_DEFINITION',t0,{kind:'actions',data:{name:'Train',tagIds:[tag.id],completion:{type:'time',minimumMinutes:30},resultFields:[{id:'effort',type:'score',label:'Effort',minimum:0,maximum:10,required:true}]}});state=result.state;const action=result.value;
result=issue(state,'ADD_DEFINITION',t0,{kind:'blocks',data:{name:'Daily Health',type:'routine',config:{period:'daily'}}});state=result.state;const routine=result.value;
result=issue(state,'ADD_RELATIONSHIP',t0,{blockId:routine.id,kind:'Action',refId:action.id});state=result.state;const routineRelationship=result.value;
state=issue(state,'EDIT_RELATIONSHIP',t0,{blockId:routine.id,relationshipId:routineRelationship.id,required:true,weight:1,config:{time:'14:00',reminderMinutes:[30],alarm:true}}).state;
result=issue(state,'ACTIVATE',t0,{blockId:routine.id,schedule:{period:'daily'}});state=result.state;
state=reconcile(state,at(t0));const run=state.runs[0];
assert.equal(run.deadlineAt,'2026-03-29T00:00:00.000Z');
assert.equal(run.children[0].dueAt,'2026-03-28T14:00:00.000Z');
assert.ok(alarmRequests(state,at(t0)).some(x=>x.id===`${run.children[0].id}:alarm`),'Routine child alarm is scheduled');
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
result=issue(state,'ADD_ENTRY','2026-03-30T07:00:00Z',{blockId:list.id,kind:'Action',refId:action.id,schedule:{mode:'daily',time:'10:00'},deadlineMinutes:60});state=result.state;const listedAction=result.value;
state=issue(state,'ACTIVATE','2026-03-30T07:00:00Z',{blockId:list.id}).state;
state=reconcile(state,at('2026-03-30T07:10:00Z'));assert.ok(state.occurrences.length>0);
const occ=state.occurrences.find(o=>o.entryId===todo.id&&o.dueAt==='2026-03-30T09:00:00.000Z');assert.ok(occ);
assert.equal(todo.unfinished,'expire','new Action List items use the automatic missed default');
assert.ok(alarmRequests(state,at('2026-03-30T07:10:00Z')).some(x=>x.id===`${occ.id}:alarm`));
state=issue(state,'COMPLETE_TODO','2026-03-30T09:00:00Z',{occurrenceId:occ.id}).state;
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

let safety=emptyState();
add=issue(safety,'ADD_DEFINITION','2026-07-03T08:00:00Z',{kind:'categories',data:{name:'Temporary'}});safety=add.state;
safety=issue(safety,'BIN','2026-07-03T08:01:00Z',{kind:'categories',id:add.value.id}).state;
assert.equal(safety.bin.length,1);
safety=issue(safety,'EMPTY_BIN','2026-07-03T08:02:00Z').state;
assert.equal(safety.bin.length,0);assert.equal(safety.restorePoints.length,1,'permanent emptying creates a restore point');
assert.equal(safety.restorePoints[0].state.bin.length,1,'restore point preserves the Bin before emptying');

let manager=emptyState();
add=issue(manager,'ADD_DEFINITION','2026-07-04T08:00:00Z',{kind:'categories',data:{name:'Cleanup'}});manager=add.state;const cleanupCategory=add.value;
add=issue(manager,'ADD_DEFINITION','2026-07-04T08:01:00Z',{kind:'tags',data:{name:'Unused Tag',categoryId:cleanupCategory.id}});manager=add.state;const cleanupTag=add.value;
const untouched=JSON.stringify(manager);
assert.throws(()=>issue(manager,'BULK_BIN','2026-07-04T08:02:00Z',{items:[{kind:'categories',id:cleanupCategory.id},{kind:'tags',id:cleanupTag.id}]}),/Still used/);
assert.equal(JSON.stringify(manager),untouched,'blocked bulk deletion is atomic');
manager=issue(manager,'BULK_ARCHIVE','2026-07-04T08:03:00Z',{items:[{kind:'tags',id:cleanupTag.id}]}).state;
assert.equal(manager.tags[0].status,'ARCHIVED');
manager=issue(manager,'BULK_UNARCHIVE','2026-07-04T08:04:00Z',{items:[{kind:'tags',id:cleanupTag.id}]}).state;
assert.equal(manager.tags[0].status,'ACTIVE');
add=issue(manager,'ADD_DEFINITION','2026-07-04T08:05:00Z',{kind:'actions',data:{name:'Temporary Log',completion:{type:'quantity',target:1}}});manager=add.state;const cleanupAction=add.value;
manager=issue(manager,'LOG_ACTION','2026-07-04T08:06:00Z',{actionId:cleanupAction.id,quantity:1}).state;
assert.equal(definitionImpact(manager,'actions',cleanupAction.id).logs,1);
assert.equal(dataClearImpact(manager,{categories:['actionLogs'],dateMode:'all'}).total,1);
manager=issue(manager,'CLEAR_DATA','2026-07-04T08:07:00Z',{categories:['actionLogs'],dateMode:'all'}).state;
assert.equal(manager.actionLogs.length,0);assert.equal(manager.restorePoints.length,1);
assert.equal(manager.restorePoints[0].state.actionLogs.length,1,'selective clear is recoverable');

let projects=emptyState();
let pAdd=issue(projects,'ADD_DEFINITION','2026-07-05T08:00:00Z',{kind:'actions',data:{name:'Research',completion:{type:'quantity',target:1}}});projects=pAdd.state;const research=pAdd.value;
pAdd=issue(projects,'ADD_DEFINITION','2026-07-05T08:00:00Z',{kind:'actions',data:{name:'Build beta',completion:{type:'quantity',target:1}}});projects=pAdd.state;const buildBeta=pAdd.value;
pAdd=issue(projects,'ADD_DEFINITION','2026-07-05T08:00:00Z',{kind:'blocks',data:{name:'Launch SAMT beta',type:'project',config:{outcome:'Ship a stable beta',requirements:'Android build passes',plannedStartAt:'2026-07-05T08:30:00Z',deadlineOffsetMinutes:120,deadlinePolicy:'continue_overdue',completionMode:'required_only',finishBehavior:'ready_to_finish',primary:true}}});projects=pAdd.state;const project=pAdd.value;
pAdd=issue(projects,'ADD_RELATIONSHIP','2026-07-05T08:00:00Z',{blockId:project.id,kind:'Action',refId:research.id,required:true,config:{milestone:true}});projects=pAdd.state;const researchRel=pAdd.value;
pAdd=issue(projects,'ADD_RELATIONSHIP','2026-07-05T08:00:00Z',{blockId:project.id,kind:'Action',refId:buildBeta.id,required:true,config:{dependsOn:[researchRel.id],availableOffsetMinutes:30,deadlineOffsetMinutes:60}});projects=pAdd.state;const buildRel=pAdd.value;
projects=issue(projects,'ACTIVATE','2026-07-05T09:00:00Z',{blockId:project.id}).state;
let projectRun=projects.runs.find(r=>r.blockId===project.id);
assert.equal(projectRun.plannedStartAt,'2026-07-05T08:30:00Z');
assert.equal(projectRun.actualStartAt,'2026-07-05T09:00:00.000Z');
assert.equal(projectRun.deadlineAt,'2026-07-05T11:00:00.000Z');
assert.equal(projectRun.children.find(c=>c.relationshipId===buildRel.id).status,'LOCKED','Project prerequisites lock downstream work');
projects=issue(projects,'EDIT_DEFINITION','2026-07-05T09:01:00Z',{kind:'blocks',id:project.id,changes:{name:'Renamed live Project',config:{...project.config,outcome:'Changed future outcome'}}}).state;
assert.equal(projects.runs.find(r=>r.id===projectRun.id).blockSnapshot.config.outcome,'Ship a stable beta','active Project keeps its start snapshot');
projects=issue(projects,'LOG_ACTION','2026-07-05T09:10:00Z',{actionId:research.id,quantity:1}).state;
projectRun=projects.runs.find(r=>r.id===projectRun.id);
assert.equal(projectRun.children.find(c=>c.relationshipId===buildRel.id).status,'OPEN','Project child unlocks after prerequisite completion');
const buildChild=projectRun.children.find(c=>c.relationshipId===buildRel.id);
projects=issue(projects,'BLOCK_PROJECT_CHILD','2026-07-05T09:12:00Z',{runId:projectRun.id,childId:buildChild.id,reason:'Waiting for certificate',expectedUnblockAt:'2026-07-05T10:00:00Z'}).state;
assert.equal(projects.runs.find(r=>r.id===projectRun.id).children.find(c=>c.id===buildChild.id).status,'BLOCKED');
projects=issue(projects,'UNBLOCK_PROJECT_CHILD','2026-07-05T09:20:00Z',{runId:projectRun.id,childId:buildChild.id}).state;
assert.equal(projects.runs.find(r=>r.id===projectRun.id).children.find(c=>c.id===buildChild.id).status,'OPEN');
projects=reconcile(projects,at('2026-07-05T11:01:00Z'));projectRun=projects.runs.find(r=>r.id===projectRun.id);
assert.equal(projectRun.status,'OVERDUE','soft Project deadline preserves the live Run');
assert.equal(projectRun.children.find(c=>c.relationshipId===researchRel.id).status,'DONE','overdue never erases completed Project work');
projects=issue(projects,'LOG_ACTION','2026-07-05T11:02:00Z',{actionId:buildBeta.id,quantity:1}).state;projectRun=projects.runs.find(r=>r.id===projectRun.id);
assert.equal(projectRun.status,'READY_TO_FINISH','Project waits for an explicit finish by default');
projects=issue(projects,'FINISH_RUN','2026-07-05T11:03:00Z',{runId:projectRun.id}).state;
assert.equal(projects.runs.find(r=>r.id===projectRun.id).status,'COMPLETED');

let hard=emptyState();
pAdd=issue(hard,'ADD_DEFINITION','2026-07-06T09:00:00Z',{kind:'actions',data:{name:'Submit',completion:{type:'quantity',target:1}}});hard=pAdd.state;const hardAction=pAdd.value;
pAdd=issue(hard,'ADD_DEFINITION','2026-07-06T09:00:00Z',{kind:'blocks',data:{name:'Hard deadline',type:'project',config:{deadlineOffsetMinutes:30,deadlinePolicy:'expire_unfinished',completionMode:'required_only',finishBehavior:'ready_to_finish'}}});hard=pAdd.state;const hardProject=pAdd.value;
hard=issue(hard,'ADD_RELATIONSHIP','2026-07-06T09:00:00Z',{blockId:hardProject.id,kind:'Action',refId:hardAction.id,required:true}).state;
hard=issue(hard,'ACTIVATE','2026-07-06T09:00:00Z',{blockId:hardProject.id}).state;
hard=reconcile(hard,at('2026-07-06T09:31:00Z'));
assert.equal(hard.runs.find(r=>r.blockId===hardProject.id).status,'EXPIRED','hard Project deadline can expire unfinished scope');
assert.equal(hard.runs.find(r=>r.blockId===hardProject.id).children[0].status,'MISSED');


let conditionState=emptyState();
let cAdd=issue(conditionState,'ADD_DEFINITION','2026-07-07T09:00:00Z',{kind:'actions',data:{name:'Quality check',completion:{type:'quantity',target:1},resultFields:[{id:'quality',label:'Quality',type:'score',required:true,minimum:0,maximum:10}]}});conditionState=cAdd.state;const qualityAction=cAdd.value;
cAdd=issue(conditionState,'ADD_DEFINITION','2026-07-07T09:00:00Z',{kind:'blocks',data:{name:'Condition Project',type:'project',config:{completionMode:'required_only',conditionMode:'all',conditions:[{id:'req',type:'required'},{id:'score',type:'result',actionId:qualityAction.id,resultId:'quality',operator:'>=',value:8,aggregate:'latest'}],finishBehavior:'ready_to_finish'}}});conditionState=cAdd.state;const conditionProject=cAdd.value;
conditionState=issue(conditionState,'ADD_RELATIONSHIP','2026-07-07T09:00:00Z',{blockId:conditionProject.id,kind:'Action',refId:qualityAction.id,required:true}).state;
conditionState=issue(conditionState,'ACTIVATE','2026-07-07T09:00:00Z',{blockId:conditionProject.id}).state;let conditionRun=conditionState.runs.find(r=>r.blockId===conditionProject.id);
conditionState=issue(conditionState,'LOG_ACTION','2026-07-07T09:05:00Z',{actionId:qualityAction.id,quantity:1,results:{quality:7}}).state;conditionRun=conditionState.runs.find(r=>r.id===conditionRun.id);
assert.equal(conditionRun.status,'IN_PROGRESS','required work alone does not bypass a Result condition');
assert.equal(conditionRun.conditionResults.find(x=>x.id==='score').actual,7);
conditionState=issue(conditionState,'LOG_ACTION','2026-07-07T09:06:00Z',{actionId:qualityAction.id,quantity:1,results:{quality:9}}).state;conditionRun=conditionState.runs.find(r=>r.id===conditionRun.id);
assert.equal(conditionRun.status,'READY_TO_FINISH','ALL Project conditions can become ready without auto-finishing');
assert.equal(conditionRun.conditionResults.find(x=>x.id==='score').reached,true);

let resolution=emptyState();
cAdd=issue(resolution,'ADD_DEFINITION','2026-07-09T09:00:00Z',{kind:'actions',data:{name:'Optional evidence',completion:{type:'quantity',target:1}}});resolution=cAdd.state;const evidence=cAdd.value;
cAdd=issue(resolution,'ADD_DEFINITION','2026-07-09T09:00:00Z',{kind:'blocks',data:{name:'Resolution Project',type:'project',config:{completionMode:'required_only',finishBehavior:'ready_to_finish'}}});resolution=cAdd.state;const resolutionProject=cAdd.value;
resolution=issue(resolution,'ADD_RELATIONSHIP','2026-07-09T09:00:00Z',{blockId:resolutionProject.id,kind:'Action',refId:evidence.id,required:true,config:{milestone:true}}).state;
resolution=issue(resolution,'ACTIVATE','2026-07-09T09:00:00Z',{blockId:resolutionProject.id}).state;let resolutionRun=resolution.runs.find(r=>r.blockId===resolutionProject.id),resolutionChild=resolutionRun.children[0];
resolution=issue(resolution,'RESOLVE_CHILD','2026-07-09T09:05:00Z',{runId:resolutionRun.id,childId:resolutionChild.id,status:'EXCUSED',notes:'Waived with reason'}).state;resolutionRun=resolution.runs.find(r=>r.id===resolutionRun.id);
assert.equal(resolutionRun.children[0].status,'EXCUSED');
assert.equal(resolutionRun.status,'READY_TO_FINISH','excused required work remains distinct but can satisfy mandatory scope');


let scoped=emptyState();
let sAdd=issue(scoped,'ADD_DEFINITION','2026-07-08T09:00:00Z',{kind:'actions',data:{name:'Base work',completion:{type:'quantity',target:1}}});scoped=sAdd.state;const baseWork=sAdd.value;
sAdd=issue(scoped,'ADD_DEFINITION','2026-07-08T09:00:00Z',{kind:'actions',data:{name:'Added scope',completion:{type:'quantity',target:1}}});scoped=sAdd.state;const addedScope=sAdd.value;
sAdd=issue(scoped,'ADD_DEFINITION','2026-07-08T09:00:00Z',{kind:'blocks',data:{name:'Scoped Project',type:'project',config:{completionMode:'required_only',finishBehavior:'ready_to_finish'}}});scoped=sAdd.state;const scopedProject=sAdd.value;
scoped=issue(scoped,'ADD_RELATIONSHIP','2026-07-08T09:00:00Z',{blockId:scopedProject.id,kind:'Action',refId:baseWork.id,required:true}).state;
scoped=issue(scoped,'ACTIVATE','2026-07-08T09:00:00Z',{blockId:scopedProject.id}).state;let scopedRun=scoped.runs.find(r=>r.blockId===scopedProject.id),startRelationshipCount=scopedRun.blockSnapshot.relationships.length;
sAdd=issue(scoped,'ADD_RELATIONSHIP','2026-07-08T09:10:00Z',{blockId:scopedProject.id,kind:'Action',refId:addedScope.id,required:false,scopeRunIds:[scopedRun.id]});scoped=sAdd.state;const liveRel=sAdd.value;scopedRun=scoped.runs.find(r=>r.id===scopedRun.id);
assert.equal(scopedRun.blockSnapshot.relationships.length,startRelationshipCount,'scope change never rewrites the Run start snapshot');
assert.ok(scopedRun.children.some(c=>c.relationshipId===liveRel.id&&c.inScope===true));
assert.equal(scopedRun.scopeChanges.at(-1).type,'ADD');
scoped=issue(scoped,'EDIT_RELATIONSHIP','2026-07-08T09:12:00Z',{blockId:scopedProject.id,relationshipId:liveRel.id,required:true,weight:1,config:{milestone:true},scopeRunIds:[scopedRun.id]}).state;scopedRun=scoped.runs.find(r=>r.id===scopedRun.id);
assert.equal(scopedRun.children.find(c=>c.relationshipId===liveRel.id).milestone,true);
assert.equal(scopedRun.scopeChanges.at(-1).type,'EDIT');
scoped=issue(scoped,'REMOVE_RELATIONSHIP','2026-07-08T09:14:00Z',{blockId:scopedProject.id,relationshipId:liveRel.id,scopeRunIds:[scopedRun.id]}).state;scopedRun=scoped.runs.find(r=>r.id===scopedRun.id);
assert.equal(scopedRun.children.find(c=>c.relationshipId===liveRel.id).status,'REMOVED');
assert.equal(scopedRun.scopeChanges.at(-1).type,'REMOVE');
assert.equal(scopedRun.blockSnapshot.relationships.length,startRelationshipCount,'start snapshot remains immutable after all scope changes');



// PLAN EVERYTHING stabilization regressions.
// Blank Action List deadlines are truly optional.
let peNoDeadline=emptyState();
let peAdd=issue(peNoDeadline,'ADD_DEFINITION','2026-01-05T07:00:00Z',{kind:'blocks',data:{name:'No deadline list',type:'action_list'}});peNoDeadline=peAdd.state;const peNoDeadlineList=peAdd.value;
peAdd=issue(peNoDeadline,'ADD_ENTRY','2026-01-05T07:00:00Z',{blockId:peNoDeadlineList.id,kind:'Todo',name:'Flexible task',schedule:{mode:'daily',time:'09:00'},deadlineMinutes:null,unfinished:'expire'});peNoDeadline=peAdd.state;const peFlexibleTodo=peAdd.value;
peNoDeadline=issue(peNoDeadline,'ACTIVATE','2026-01-05T07:00:00Z',{blockId:peNoDeadlineList.id}).state;
peNoDeadline=reconcile(peNoDeadline,at('2026-01-05T10:00:00Z'));
const peNoDeadlineOcc=peNoDeadline.occurrences.find(o=>o.entryId===peFlexibleTodo.id&&o.dueAt==='2026-01-05T09:00:00.000Z');
assert.equal(peNoDeadlineOcc.deadlineAt,null);
assert.equal(peNoDeadlineOcc.status,'OPEN','blank deadline must not imply due-time expiry');

// Archive is administrative, not failure.
let peArchived=emptyState();
peAdd=issue(peArchived,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'actions',data:{name:'Archive child',completion:{type:'quantity',target:1}}});peArchived=peAdd.state;const peArchiveAction=peAdd.value;
peAdd=issue(peArchived,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Archive routine',type:'routine',config:{period:'daily'}}});peArchived=peAdd.state;const peArchiveRoutine=peAdd.value;
peArchived=issue(peArchived,'ADD_RELATIONSHIP','2026-01-05T08:00:00Z',{blockId:peArchiveRoutine.id,kind:'Action',refId:peArchiveAction.id}).state;
peArchived=issue(peArchived,'ACTIVATE','2026-01-05T08:00:00Z',{blockId:peArchiveRoutine.id,schedule:{period:'daily'}}).state;
const peArchivedRunId=peArchived.runs[0].id;
peArchived=issue(peArchived,'ARCHIVE','2026-01-05T10:00:00Z',{kind:'blocks',id:peArchiveRoutine.id}).state;
assert.equal(peArchived.runs.find(r=>r.id===peArchivedRunId).status,'CANCELLED');
assert.equal(peArchived.runs.find(r=>r.id===peArchivedRunId).children[0].status,'SKIPPED');
assert.equal(peArchived.runs.filter(r=>r.status==='MISSED').length,0,'archive must not manufacture missed Runs');

// Timezone changes regenerate future Action List occurrences without rewriting facts.
let peZones=emptyState();
peAdd=issue(peZones,'ADD_DEFINITION','2026-09-22T05:00:00Z',{kind:'blocks',data:{name:'Timezone list',type:'action_list'}});peZones=peAdd.state;const peZoneList=peAdd.value;
peAdd=issue(peZones,'ADD_ENTRY','2026-09-22T05:00:00Z',{blockId:peZoneList.id,kind:'Todo',name:'Local nine',schedule:{mode:'daily',time:'09:00'}});peZones=peAdd.state;const peZoneEntry=peAdd.value;
peZones=issue(peZones,'ACTIVATE','2026-09-22T05:00:00Z',{blockId:peZoneList.id}).state;
peZones=reconcile(peZones,at('2026-09-22T05:01:00Z'));
assert.ok(peZones.occurrences.some(o=>o.entryId===peZoneEntry.id&&o.dueAt==='2026-09-22T08:00:00.000Z'&&o.status==='OPEN'));
peZones=issue(peZones,'SET_SETTINGS','2026-09-22T05:02:00Z',{changes:{timezone:'Europe/Paris'}}).state;
assert.ok(peZones.occurrences.some(o=>o.entryId===peZoneEntry.id&&o.dueAt==='2026-09-22T08:00:00.000Z'&&o.status==='SUPERSEDED'));
assert.ok(peZones.occurrences.some(o=>o.entryId===peZoneEntry.id&&o.dueAt==='2026-09-22T07:00:00.000Z'&&o.status==='OPEN'));

// Weekly parents only expect nested daily Runs from the nested Routine activation.
let peMidweek=emptyState();
peAdd=issue(peMidweek,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'actions',data:{name:'Daily nested action',completion:{type:'quantity',target:1}}});peMidweek=peAdd.state;const peNestedAction=peAdd.value;
peAdd=issue(peMidweek,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Daily nested',type:'routine',config:{period:'daily'}}});peMidweek=peAdd.state;const peNestedDaily=peAdd.value;
peMidweek=issue(peMidweek,'ADD_RELATIONSHIP','2026-01-05T08:00:00Z',{blockId:peNestedDaily.id,kind:'Action',refId:peNestedAction.id}).state;
peAdd=issue(peMidweek,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Weekly parent midweek',type:'routine',config:{period:'weekly'}}});peMidweek=peAdd.state;const peMidweekParent=peAdd.value;
peMidweek=issue(peMidweek,'ADD_RELATIONSHIP','2026-01-05T08:00:00Z',{blockId:peMidweekParent.id,kind:'Block',refId:peNestedDaily.id}).state;
peMidweek=issue(peMidweek,'ACTIVATE','2026-01-05T08:00:00Z',{blockId:peMidweekParent.id,schedule:{period:'weekly'}}).state;
peMidweek=issue(peMidweek,'ACTIVATE','2026-01-07T08:00:00Z',{blockId:peNestedDaily.id,schedule:{period:'daily'}}).state;
for(const day of ['07','08','09','10','11']){peMidweek=reconcile(peMidweek,at(`2026-01-${day}T12:00:00Z`));peMidweek=issue(peMidweek,'LOG_ACTION',`2026-01-${day}T12:01:00Z`,{actionId:peNestedAction.id,quantity:1}).state;}
peMidweek=reconcile(peMidweek,at('2026-01-12T00:01:00Z'));
assert.equal(peMidweek.runs.find(r=>r.blockId===peMidweekParent.id&&r.startedAt==='2026-01-05T00:00:00.000Z').status,'COMPLETED');

// Paused Targets do not manufacture missed periods or count paused activity.
let pePausedTarget=emptyState();
peAdd=issue(pePausedTarget,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'actions',data:{name:'Target action',completion:{type:'quantity',target:1}}});pePausedTarget=peAdd.state;const peTargetAction=peAdd.value;
peAdd=issue(pePausedTarget,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Paused target',type:'target',config:{period:'daily',metric:'count',target:1}}});pePausedTarget=peAdd.state;const peTarget=peAdd.value;
pePausedTarget=issue(pePausedTarget,'ADD_RELATIONSHIP','2026-01-05T08:00:00Z',{blockId:peTarget.id,kind:'Action',refId:peTargetAction.id}).state;
pePausedTarget=issue(pePausedTarget,'ACTIVATE','2026-01-05T08:00:00Z',{blockId:peTarget.id}).state;
pePausedTarget=issue(pePausedTarget,'PAUSE_BLOCK','2026-01-05T12:00:00Z',{blockId:peTarget.id,resumeAt:'2026-01-07T12:00:00Z'}).state;
pePausedTarget=issue(pePausedTarget,'LOG_ACTION','2026-01-07T08:00:00Z',{actionId:peTargetAction.id,quantity:1}).state;
pePausedTarget=reconcile(pePausedTarget,at('2026-01-07T12:01:00Z'));
assert.equal(pePausedTarget.periods.filter(p=>p.blockId===peTarget.id&&p.status==='MISSED').length,0);
let peResumedPeriod=pePausedTarget.periods.filter(p=>p.blockId===peTarget.id&&p.status==='OPEN').at(-1);
assert.equal(peResumedPeriod.actual,0,'logs during Target pause are excluded');
pePausedTarget=issue(pePausedTarget,'LOG_ACTION','2026-01-07T13:00:00Z',{actionId:peTargetAction.id,quantity:1}).state;
peResumedPeriod=pePausedTarget.periods.filter(p=>p.blockId===peTarget.id&&p.status==='OPEN').at(-1);
assert.equal(peResumedPeriod.actual,1);

// MISSED logs are factual history, not successful Target progress.
let peMissedTarget=emptyState();
peAdd=issue(peMissedTarget,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'actions',data:{name:'Missable',completion:{type:'quantity',target:1}}});peMissedTarget=peAdd.state;const peMissable=peAdd.value;
peAdd=issue(peMissedTarget,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Count only success',type:'target',config:{period:'daily',metric:'count',target:1}}});peMissedTarget=peAdd.state;const peSuccessTarget=peAdd.value;
peMissedTarget=issue(peMissedTarget,'ADD_RELATIONSHIP','2026-01-05T08:00:00Z',{blockId:peSuccessTarget.id,kind:'Action',refId:peMissable.id}).state;
peMissedTarget=issue(peMissedTarget,'ACTIVATE','2026-01-05T08:00:00Z',{blockId:peSuccessTarget.id}).state;
peMissedTarget=issue(peMissedTarget,'LOG_ACTION','2026-01-05T09:00:00Z',{actionId:peMissable.id,outcome:'MISSED',quantity:0}).state;
assert.equal(peMissedTarget.periods.find(p=>p.blockId===peSuccessTarget.id&&p.status==='OPEN').actual,0);

// Same-day pause/resume must not duplicate a calendar Run.
let peSameDay=emptyState();
peAdd=issue(peSameDay,'ADD_DEFINITION','2026-01-05T08:00:00Z',{kind:'blocks',data:{name:'Same-day pause',type:'routine',config:{period:'daily'}}});peSameDay=peAdd.state;const peSameRoutine=peAdd.value;
peSameDay=issue(peSameDay,'ACTIVATE','2026-01-05T08:00:00Z',{blockId:peSameRoutine.id,schedule:{period:'daily'}}).state;
peSameDay=issue(peSameDay,'PAUSE_BLOCK','2026-01-05T10:00:00Z',{blockId:peSameRoutine.id,resumeAt:'2026-01-05T12:00:00Z'}).state;
peSameDay=reconcile(peSameDay,at('2026-01-05T12:01:00Z'));
assert.equal(peSameDay.runs.filter(r=>r.blockId===peSameRoutine.id&&r.status==='IN_PROGRESS').length,1);
assert.equal(peSameDay.runs.filter(r=>r.blockId===peSameRoutine.id).length,1);



// Discrete Result values, multi-Result Targets and relationship completion overrides.
let peResults=emptyState();
peAdd=issue(peResults,'ADD_DEFINITION','2026-02-02T08:00:00Z',{kind:'actions',data:{name:'Prayer score action',completion:{type:'quantity',target:1},resultFields:[{id:'score_a',label:'Score A',type:'score',required:true,minimum:0,maximum:10,allowedValues:[0,3,10]},{id:'score_b',label:'Score B',type:'score',required:true,minimum:0,maximum:10,allowedValues:[0,3,6,10]}]}});peResults=peAdd.state;const peScoredAction=peAdd.value;
assert.throws(()=>issue(peResults,'LOG_ACTION','2026-02-02T09:00:00Z',{actionId:peScoredAction.id,quantity:1,results:{score_a:5,score_b:6}}),/allowed score values/);
peAdd=issue(peResults,'ADD_DEFINITION','2026-02-02T08:01:00Z',{kind:'blocks',data:{name:'Combined score',type:'target',config:{period:'daily',metric:'result',resultRefs:[{actionId:peScoredAction.id,resultId:'score_a'},{actionId:peScoredAction.id,resultId:'score_b'}],target:13}}});peResults=peAdd.state;const peScoreTarget=peAdd.value;
peResults=issue(peResults,'ADD_RELATIONSHIP','2026-02-02T08:01:00Z',{blockId:peScoreTarget.id,kind:'Action',refId:peScoredAction.id}).state;
peResults=issue(peResults,'ACTIVATE','2026-02-02T08:02:00Z',{blockId:peScoreTarget.id}).state;
peResults=issue(peResults,'LOG_ACTION','2026-02-02T09:00:00Z',{actionId:peScoredAction.id,quantity:1,results:{score_a:10,score_b:3}}).state;
assert.equal(peResults.periods.find(p=>p.blockId===peScoreTarget.id&&p.status==='OPEN').actual,13,'Target totals multiple selected Result fields from one factual Log');

let peOverride=emptyState();
peAdd=issue(peOverride,'ADD_DEFINITION','2026-02-03T08:00:00Z',{kind:'actions',data:{name:'Shower',completion:{type:'quantity',target:1}}});peOverride=peAdd.state;const peOverrideAction=peAdd.value;
peAdd=issue(peOverride,'ADD_DEFINITION','2026-02-03T08:00:00Z',{kind:'blocks',data:{name:'Weekly Hygiene',type:'routine',config:{period:'weekly'}}});peOverride=peAdd.state;const peOverrideRoutine=peAdd.value;
peOverride=issue(peOverride,'ADD_RELATIONSHIP','2026-02-03T08:00:00Z',{blockId:peOverrideRoutine.id,kind:'Action',refId:peOverrideAction.id,config:{completion:{type:'quantity',target:2}}}).state;
peOverride=issue(peOverride,'ACTIVATE','2026-02-03T08:00:00Z',{blockId:peOverrideRoutine.id,schedule:{period:'weekly'}}).state;
peOverride=issue(peOverride,'LOG_ACTION','2026-02-03T09:00:00Z',{actionId:peOverrideAction.id,quantity:1}).state;
assert.equal(peOverride.runs.find(r=>r.blockId===peOverrideRoutine.id).children[0].status,'OPEN','relationship override requires two completions');
peOverride=issue(peOverride,'LOG_ACTION','2026-02-03T10:00:00Z',{actionId:peOverrideAction.id,quantity:1}).state;
assert.equal(peOverride.runs.find(r=>r.blockId===peOverrideRoutine.id).children[0].status,'DONE');

assert.throws(()=>issue(peOverride,'EDIT_DEFINITION','2026-02-03T10:05:00Z',{kind:'blocks',id:peOverrideRoutine.id,changes:{type:'project'}}),/Block type cannot be changed/);


assert.equal(LAYOUTS.length,5,'SAMT ships five distinct layout choices');
assert.ok(TYPOGRAPHIES.length>=5,'writing style stays independent from layout');
assert.ok(Object.keys(PALETTES).length>=10,'colour library includes ready palettes');
assert.deepEqual(Object.keys(FULL_PRESETS).sort(),['bare','celestial','paper','pulse','terminal']);

const visualState=emptyState();
for(const appearance of ['light','dark','neon']){
  visualState.settings.appearance=appearance;
  visualState.settings.visual={...visualState.settings.visual,layout:'matrix',typography:'technical',paletteId:'midnight',palette:{...PALETTES.midnight}};
  const vars={},fakeRoot={dataset:{},style:{setProperty:(key,value)=>{vars[key]=value;}}};
  const applied=applyVisual(fakeRoot,visualState.settings,false);
  assert.equal(applied.appearance,appearance);
  assert.equal(fakeRoot.dataset.layout,'matrix');
  assert.equal(fakeRoot.dataset.type,'technical');
  assert.ok(contrast(vars['--ink'],vars['--bg'])>=7,'generated body text keeps strong contrast');
  assert.ok(contrast(vars['--accent-ink'],vars['--accent'])>=4.5,'generated button text remains readable on the chosen accent');
}
visualState.settings.appearance='system';
assert.equal(resolvedAppearance(visualState.settings,true),'dark');
assert.equal(resolvedAppearance(visualState.settings,false),'light');

const exportedStyle=presetFromSettings(visualState.settings,{category_health:'#123456'});
const parsedStyle=parseStylePreset(JSON.stringify(exportedStyle));
assert.equal(parsedStyle.format,'samt-style-preset');
assert.equal(parsedStyle.layout,'matrix');
assert.equal(parsedStyle.categoryColors.category_health,'#123456');
assert.throws(()=>parseStylePreset(JSON.stringify({...exportedStyle,palette:{...exportedStyle.palette,primary:'#zzzzzz'}})),/Invalid primary colour/);
assert.equal(visualSettings({visual:{layout:'journal',paletteId:'paper-does-not-exist',palette:{...PALETTES.sand}}}).layout,'journal');

console.log('PASS: domain contract plus five-layout visual engine, palette derivation, contrast safety and style preset round trip');
