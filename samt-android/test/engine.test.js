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
state=issue(state,'ACTIVATE','2026-03-30T07:00:00Z',{blockId:list.id}).state;
state=reconcile(state,at('2026-03-30T07:10:00Z'));assert.ok(state.occurrences.length>0);
const occ=state.occurrences.find(o=>o.entryId===todo.id&&o.dueAt==='2026-03-30T09:00:00.000Z');assert.ok(occ);
assert.ok(alarmRequests(state,at('2026-03-30T07:10:00Z')).some(x=>x.id===`${occ.id}:alarm`));
state=issue(state,'COMPLETE_TODO','2026-03-30T09:01:00Z',{occurrenceId:occ.id}).state;
assert.equal(state.actionLogs.length,0,'Todo does not create factual Action Log');

// An Action Log is one record even when it contributes to two contexts.
const current=state.runs.find(r=>r.status==='IN_PROGRESS');
result=issue(state,'LOG_ACTION','2026-03-30T09:03:00Z',{actionId:action.id,durationMinutes:45,results:{effort:8},contexts:[current.children[0].id,'another-context']});state=result.state;
assert.equal(state.actionLogs.length,1);
assert.equal(overview(state).uniqueMinutes,45);
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
result=issue(fresh,'ADD_DEFINITION','2026-06-02T09:00:00Z',{kind:'blocks',data:{name:'Write article',type:'workflow'}});fresh=result.state;const flow=result.value;
fresh=issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:00:00Z',{blockId:flow.id,kind:'Action',refId:draft.id}).state;
fresh=issue(fresh,'ADD_RELATIONSHIP','2026-06-02T09:00:00Z',{blockId:flow.id,kind:'Action',refId:draft.id}).state;
fresh=issue(fresh,'RUN_NOW','2026-06-02T09:00:00Z',{blockId:flow.id}).state;
let workflow=fresh.runs.find(x=>x.blockId===flow.id);
assert.equal(workflow.children[1].status,'LOCKED');
fresh=issue(fresh,'LOG_ACTION','2026-06-02T09:01:00Z',{actionId:draft.id,quantity:1,contexts:[workflow.children[0].id]}).state;
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
console.log('PASS: snapshots, DST rollover, missed routines, Action/Todo distinction, one log across contexts, Results, cycles, alarms, Avoid zero periods, Workflow, Target and atomic backups');
