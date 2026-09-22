package app.samt.android;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;
import java.util.Iterator;

/** Closes calendar Routine Runs without opening the UI. The JS engine applies
 * the same rules whenever the app opens, so delayed/battery-restricted delivery
 * still catches up from immutable timestamps. */
public class BoundaryReceiver extends BroadcastReceiver {
    private static String id(String prefix){return prefix+"_"+UUID.randomUUID();}
    private static String iso(long epoch){return Instant.ofEpochMilli(epoch).toString();}
    private static long time(String value){try{return Instant.parse(value).toEpochMilli();}catch(Exception e){return 0;}}
    private static ZoneId zone(JSONObject state) {
        try{return ZoneId.of(state.getJSONObject("settings").optString("timezone","Europe/London"));}
        catch(Exception e){return ZoneId.of("Europe/London");}
    }
    private static long start(long timestamp,String period,JSONObject state) {
        ZoneId zone=zone(state);LocalDate day=Instant.ofEpochMilli(timestamp).atZone(zone).toLocalDate();
        if("weekly".equals(period)) {
            int first=state.optJSONObject("settings").optInt("weekStartsOn",1);
            day=day.with(TemporalAdjusters.previousOrSame(DayOfWeek.of(first==0?7:first)));
        }
        return day.atStartOfDay(zone).toInstant().toEpochMilli();
    }
    private static long end(long start,String period,JSONObject state) {
        ZonedDateTime local=Instant.ofEpochMilli(start).atZone(zone(state));
        return local.toLocalDate().plusDays("weekly".equals(period)?7:1).atStartOfDay(zone(state)).toInstant().toEpochMilli();
    }
    private static PendingIntent pending(Context context) {
        Intent i=new Intent(context,BoundaryReceiver.class).setAction("app.samt.BOUNDARY").setData(Uri.parse("samt://calendar/midnight"));
        return PendingIntent.getBroadcast(context,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    public static void schedule(Context context) {
        try {
            String raw=context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("state","");
            ZoneId zone=raw.isEmpty()?ZoneId.of("Europe/London"):zone(new JSONObject(raw));
            long at=LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
            if(!raw.isEmpty()) {
                JSONArray activations=new JSONObject(raw).optJSONArray("activations");
                if(activations!=null)for(int i=0;i<activations.length();i++) {
                    JSONObject activation=activations.getJSONObject(i);long resume=time(activation.optString("resumeAt"));
                    if("PAUSED".equals(activation.optString("status"))&&resume>System.currentTimeMillis())at=Math.min(at,resume);
                }
            }
            AlarmManager manager=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
            try {
                if(Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms())manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending(context));
                else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending(context));
            }catch(SecurityException e){manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending(context));}
        }catch(Exception ignored){}
    }
    private static JSONObject find(JSONArray items,String ref) throws Exception {
        for(int i=0;i<items.length();i++){JSONObject obj=items.getJSONObject(i);if(ref.equals(obj.optString("id")))return obj;}return null;
    }
    private static long relationshipDue(JSONObject relationship,long runStart,String period,JSONObject state) {
        try {
            JSONObject config=relationship.optJSONObject("config");if(config==null||config.optString("time").isEmpty())return 0;
            ZoneId zone=zone(state);LocalDate day=Instant.ofEpochMilli(runStart).atZone(zone).toLocalDate();
            if("weekly".equals(period)&&config.has("weekday")&&!config.isNull("weekday")) {
                int current=day.getDayOfWeek().getValue()%7,wanted=config.getInt("weekday");
                day=day.plusDays((wanted-current+7)%7);
            }
            return day.atTime(LocalTime.parse(config.getString("time"))).atZone(zone).toInstant().toEpochMilli();
        }catch(Exception ignored){return 0;}
    }
    private static JSONObject newRun(JSONObject block,JSONObject activation,long at,String period,JSONObject state) throws Exception {
        JSONObject run=new JSONObject().put("id",id("run")).put("blockId",block.getString("id")).put("type","routine")
            .put("startedAt",iso(at)).put("deadlineAt",iso(end(at,period,state)))
            .put("status","IN_PROGRESS").put("blockSnapshot",new JSONObject(block.toString()))
            .put("finishedAt",JSONObject.NULL).put("activationId",activation.getString("id"))
            .put("transitions",new JSONArray());
        JSONArray children=new JSONArray(),rels=block.optJSONArray("relationships");
        if(rels!=null)for(int j=0;j<rels.length();j++) {
            JSONObject rel=rels.getJSONObject(j);
            JSONObject source=find(state.getJSONArray("Action".equals(rel.getString("kind"))?"actions":"blocks"),rel.getString("refId"));
            JSONObject config=rel.optJSONObject("config");if(config==null)config=new JSONObject();
            JSONObject child=new JSONObject().put("id",id("child")).put("relationshipId",rel.getString("id"))
                .put("kind",rel.getString("kind")).put("refId",rel.getString("refId"))
                .put("required",rel.optBoolean("required",true)).put("status","OPEN")
                .put("config",new JSONObject(config.toString())).put("snoozedUntil",JSONObject.NULL)
                .put("definitionSnapshot",source==null?JSONObject.NULL:new JSONObject(source.toString()));
            long due=relationshipDue(rel,at,period,state);child.put("dueAt",due>0?iso(due):JSONObject.NULL);children.put(child);
        }
        return run.put("children",children);
    }
    private static void history(JSONObject state,String event,long at,JSONObject details) throws Exception {
        JSONObject row=new JSONObject().put("id",id("history")).put("event",event).put("at",iso(at));
        for(Iterator<String> keys=details.keys();keys.hasNext();) {
            String key=keys.next();row.put(key,details.get(key));
        }
        state.getJSONArray("history").put(row);
    }
    private static void evaluateChildren(JSONObject run,JSONObject state,long deadline) throws Exception {
        JSONArray children=run.getJSONArray("children"),logs=state.getJSONArray("actionLogs"),runs=state.getJSONArray("runs");
        long begin=time(run.getString("startedAt"));
        for(int i=0;i<children.length();i++) {
            JSONObject child=children.getJSONObject(i),snapshot=child.optJSONObject("definitionSnapshot");
            if(snapshot==null)continue;
            if("Action".equals(child.optString("kind"))&&"Avoid".equals(snapshot.optString("direction"))) {
                double actual=0;String actionId=child.getString("refId");
                for(int j=0;j<logs.length();j++) {
                    JSONObject log=logs.getJSONObject(j);long when=time(log.optString("at"));
                    if(actionId.equals(log.optString("actionId"))&&when>=begin&&when<deadline)actual+=Math.max(1,log.optDouble("quantity",1));
                }
                double limit=snapshot.optJSONObject("avoid")==null?0:snapshot.getJSONObject("avoid").optDouble("limit",0);
                child.put("actual",actual).put("status",actual<=limit?"DONE":"MISSED").put("resolvedAt",iso(deadline));
            }
            if("Block".equals(child.optString("kind"))&&"routine".equals(snapshot.optString("type"))&&"OPEN".equals(child.optString("status"))) {
                int count=0;boolean allDone=true;
                for(int j=0;j<runs.length();j++) {
                    JSONObject nested=runs.getJSONObject(j);long started=time(nested.optString("startedAt"));
                    if(child.getString("refId").equals(nested.optString("blockId"))&&started>=begin&&started<deadline){count++;allDone&="COMPLETED".equals(nested.optString("status"));}
                }
                String cadence=snapshot.optJSONObject("config")==null?"daily":snapshot.getJSONObject("config").optString("period","daily");
                int expected="daily".equals(cadence)?(int)java.time.temporal.ChronoUnit.DAYS.between(
                    Instant.ofEpochMilli(begin).atZone(zone(state)).toLocalDate(),Instant.ofEpochMilli(deadline).atZone(zone(state)).toLocalDate()):1;
                if(count>=Math.max(1,expected)&&allDone)child.put("status","DONE").put("resolvedAt",iso(deadline));
            }
        }
    }
    private static boolean includes(JSONArray values,String key) {
        if(values==null)return false;
        for(int i=0;i<values.length();i++)if(key.equals(values.optString(i)))return true;
        return false;
    }
    private static long dueFor(JSONObject entry,LocalDate day,ZoneId zone) {
        try {
            JSONObject schedule=entry.optJSONObject("schedule");if(schedule==null)return 0;
            String mode=schedule.optString("mode","manual");if("manual".equals(mode))return 0;
            if("once".equals(mode)){
                long at=time(schedule.optString("at"));
                return at>0&&Instant.ofEpochMilli(at).atZone(zone).toLocalDate().equals(day)?at:0;
            }
            if("specific_dates".equals(mode)&&!includes(schedule.optJSONArray("dates"),day.toString()))return 0;
            if("weekly".equals(mode)){
                JSONArray weekdays=schedule.optJSONArray("weekdays");boolean match=false;
                int weekday=day.getDayOfWeek().getValue()%7;
                if(weekdays==null)match=weekday==1;
                else for(int i=0;i<weekdays.length();i++)if(weekdays.optInt(i,-1)==weekday)match=true;
                if(!match)return 0;
            }
            if("monthly".equals(mode)&&day.getDayOfMonth()!=schedule.optInt("day",1))return 0;
            if("yearly".equals(mode)&&(day.getMonthValue()!=schedule.optInt("month",1)||day.getDayOfMonth()!=schedule.optInt("day",1)))return 0;
            if("interval".equals(mode)){
                long anchor=time(schedule.optString("anchorAt",entry.optString("createdAt")));if(anchor==0)return 0;
                long days=ChronoUnit.DAYS.between(Instant.ofEpochMilli(anchor).atZone(zone).toLocalDate(),day);
                int every=Math.max(1,schedule.optInt("every",1))*("weeks".equals(schedule.optString("unit"))?7:1);
                if(days<0||days%every!=0)return 0;
            }
            if(!"specific_dates".equals(mode)&&!"daily".equals(mode)&&!"weekly".equals(mode)&&!"monthly".equals(mode)&&!"yearly".equals(mode)&&!"interval".equals(mode))return 0;
            LocalTime local=LocalTime.parse(schedule.optString("time","09:00"));
            return day.atTime(local).atZone(zone).toInstant().toEpochMilli();
        }catch(Exception ignored){return 0;}
    }
    private static boolean eligible(JSONObject entry,long due) {
        if(entry.optBoolean("paused")||"ARCHIVED".equals(entry.optString("status")))return false;
        long from=time(entry.optString("activeFrom")),until=time(entry.optString("activeUntil")),repeatEnd=time(entry.optString("repeatEnd"));
        if(from>0&&due<from||until>0&&due>=until||repeatEnd>0&&due>=repeatEnd)return false;
        JSONArray off=entry.optJSONArray("offPeriods");
        if(off!=null)for(int i=0;i<off.length();i++){
            JSONObject p=off.optJSONObject(i);if(p==null)continue;
            long start=time(p.optString("start")),end=time(p.optString("end"));
            if(due>=start&&(end==0||due<end)&&p.isNull("notifiedAt"))return false;
        }
        return true;
    }
    private static void reconcileEntries(JSONObject state,long now) throws Exception {
        JSONArray blocks=state.getJSONArray("blocks"),activations=state.getJSONArray("activations"),occurrences=state.getJSONArray("occurrences");
        updateOccurrenceStatus(state,now);
        ZoneId zone=zone(state);LocalDate today=Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        for(int i=0;i<blocks.length();i++) {
            JSONObject b=blocks.getJSONObject(i);if(!"action_list".equals(b.optString("type"))||"ARCHIVED".equals(b.optString("status")))continue;
            JSONObject activation=null;
            for(int j=0;j<activations.length();j++){JSONObject a=activations.getJSONObject(j);if("ACTIVE".equals(a.optString("status"))&&b.optString("id").equals(a.optString("blockId")))activation=a;}
            if(activation==null)continue;
            JSONArray entries=b.optJSONArray("entries");if(entries==null)continue;
            for(int j=0;j<entries.length();j++) {
                JSONObject entry=entries.getJSONObject(j);long created=time(entry.optString("createdAt")),activated=time(activation.optString("startedAt"));
                JSONObject meta=state.optJSONObject("meta");long floor=meta==null?0:time(meta.optString("occurrenceFloorAt"));
                LocalDate first=Instant.ofEpochMilli(Math.max(floor,Math.max(created,activated))).atZone(zone).toLocalDate();
                long from=time(entry.optString("activeFrom"));if(from>0) {
                    LocalDate date=Instant.ofEpochMilli(from).atZone(zone).toLocalDate();if(date.isAfter(first))first=date;
                }
                LocalDate cutoff=today.minusDays(739);if(first.isBefore(cutoff))first=cutoff;
                long lastDue=0;
                for(int k=0;k<occurrences.length();k++){
                    JSONObject previous=occurrences.getJSONObject(k);
                    if(entry.getString("id").equals(previous.optString("entryId")))lastDue=Math.max(lastDue,time(previous.optString("dueAt")));
                }
                if(lastDue>0){LocalDate recent=Instant.ofEpochMilli(lastDue).atZone(zone).toLocalDate().minusDays(1);if(recent.isAfter(first))first=recent;}
                for(LocalDate day=first;!day.isAfter(today.plusDays(14));day=day.plusDays(1)) {
                    long due=dueFor(entry,day,zone);if(due==0||!eligible(entry,due))continue;
                    boolean exists=false,blocked=false;
                    for(int k=0;k<occurrences.length();k++){
                        JSONObject o=occurrences.getJSONObject(k);
                        if(!entry.getString("id").equals(o.optString("entryId")))continue;
                        if(time(o.optString("dueAt"))==due)exists=true;
                        if("block_next".equals(entry.optString("overlap"))&&time(o.optString("dueAt"))<due&&
                            ("OPEN".equals(o.optString("status"))||"OVERDUE".equals(o.optString("status"))||"CARRIED".equals(o.optString("status"))))blocked=true;
                    }
                    if(exists||blocked)continue;
                    JSONObject target="Action".equals(entry.optString("kind"))?find(state.getJSONArray("actions"),entry.optString("refId")):null;
                    JSONObject item=target==null?new JSONObject().put("name",entry.optString("name")):new JSONObject(target.toString());
                    long deadline=entry.isNull("deadlineMinutes")?due:due+(long)(entry.optDouble("deadlineMinutes")*60000);
                    JSONObject o=new JSONObject().put("id",id("occurrence")).put("blockId",b.getString("id")).put("entryId",entry.getString("id"))
                        .put("entrySnapshot",new JSONObject(entry.toString())).put("itemSnapshot",item).put("dueAt",iso(due))
                        .put("deadlineAt",iso(deadline)).put("status","OPEN").put("createdAt",iso(now))
                        .put("resolvedAt",JSONObject.NULL).put("snoozedUntil",JSONObject.NULL).put("actionLogId",JSONObject.NULL);
                    occurrences.put(o);history(state,"occurrence_created",now,new JSONObject().put("occurrenceId",o.getString("id")).put("entryId",entry.getString("id")));
                    if(deadline<now)updateOccurrenceStatus(state,now);
                }
            }
        }
        updateOccurrenceStatus(state,now);
    }
    private static boolean resumeActivations(JSONObject state,long now) throws Exception {
        boolean changed=false;JSONArray activations=state.getJSONArray("activations"),blocks=state.getJSONArray("blocks"),runs=state.getJSONArray("runs");
        for(int i=0;i<activations.length();i++) {
            JSONObject activation=activations.getJSONObject(i);long resume=time(activation.optString("resumeAt"));
            if(!"PAUSED".equals(activation.optString("status"))||resume<=0||resume>now)continue;
            JSONObject block=find(blocks,activation.optString("blockId"));if(block==null)continue;
            String period=activation.optJSONObject("schedule")==null?"manual":activation.getJSONObject("schedule").optString("period","manual");
            boolean calendar="daily".equals(period)||"weekly".equals(period),hasRunning=false;
            long paused=time(activation.optString("pausedAt")),duration=Math.max(0,resume-paused);
            for(int j=0;j<runs.length();j++) {
                JSONObject run=runs.getJSONObject(j);if(!activation.optString("id").equals(run.optString("activationId"))||!"PAUSED".equals(run.optString("status")))continue;
                long deadline=time(run.optString("deadlineAt"));if(calendar&&deadline>0&&deadline<=resume)continue;
                run.put("status","IN_PROGRESS").put("resumedAt",iso(resume));hasRunning=true;
                if(!calendar&&deadline>0)run.put("deadlineAt",iso(deadline+duration));
                JSONArray children=run.optJSONArray("children");if(!calendar&&children!=null)for(int k=0;k<children.length();k++) {
                    JSONObject child=children.getJSONObject(k);long available=time(child.optString("availableAt")),due=time(child.optString("dueAt")),snoozed=time(child.optString("snoozedUntil"));
                    if(available>0)child.put("availableAt",iso(available+duration));if(due>0)child.put("dueAt",iso(due+duration));if(snoozed>0)child.put("snoozedUntil",iso(snoozed+duration));
                }
                run.getJSONArray("transitions").put(new JSONObject().put("id",id("transition")).put("event","RUN_RESUMED")
                    .put("at",iso(resume)).put("pauseDurationMinutes",duration/60000d));
            }
            activation.put("status","ACTIVE").put("resumedAt",iso(resume)).put("totalPausedMinutes",activation.optDouble("totalPausedMinutes",0)+duration/60000d)
                .put("pausedAt",JSONObject.NULL).put("resumeAt",JSONObject.NULL);
            if(calendar&&"routine".equals(block.optString("type"))&&!hasRunning) {
                long begin=start(resume,period,state);runs.put(newRun(block,activation,begin,period,state));
            }
            history(state,"block_resumed",resume,new JSONObject().put("blockId",block.getString("id")).put("activationId",activation.getString("id")));
            changed=true;
        }
        return changed;
    }
    private static void updateOccurrenceStatus(JSONObject state,long now) throws Exception {
        JSONArray occurrences=state.getJSONArray("occurrences");
        for(int i=0;i<occurrences.length();i++) {
            JSONObject o=occurrences.getJSONObject(i);
            if(!"OPEN".equals(o.optString("status"))||time(o.optString("deadlineAt"))>=now)continue;
            String policy=o.optJSONObject("entrySnapshot")==null?"stay_overdue":o.getJSONObject("entrySnapshot").optString("unfinished","stay_overdue");
            if("expire".equals(policy)) {
                o.put("status","MISSED").put("resolvedAt",o.getString("deadlineAt"));
                history(state,"occurrence_missed",now,new JSONObject().put("occurrenceId",o.getString("id")));
            }else o.put("status","carry_forward".equals(policy)?"CARRIED":"OVERDUE");
        }
    }
    public static void reconcile(Context context) {
        String raw=context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("state","");
        if(raw.isEmpty())return;
        try {
            JSONObject state=new JSONObject(raw);if(state.optInt("schemaVersion")!=3)return;
            JSONArray activations=state.getJSONArray("activations"),blocks=state.getJSONArray("blocks"),runs=state.getJSONArray("runs");
            long now=System.currentTimeMillis();boolean changed=resumeActivations(state,now);
            for(int pass=0;pass<2;pass++)for(int i=0;i<activations.length();i++) {
                JSONObject activation=activations.getJSONObject(i);
                if(!"ACTIVE".equals(activation.optString("status")))continue;
                String period=activation.optJSONObject("schedule")==null?"manual":activation.getJSONObject("schedule").optString("period","manual");
                if(!"daily".equals(period)&&!"weekly".equals(period))continue;
                if((pass==0)!="daily".equals(period))continue;
                JSONObject block=null;
                for(int j=0;j<blocks.length();j++)if(activation.optString("blockId").equals(blocks.getJSONObject(j).optString("id")))block=blocks.getJSONObject(j);
                if(block==null||"ARCHIVED".equals(block.optString("status"))||!"routine".equals(block.optString("type")))continue;
                JSONObject last=null;
                for(int j=0;j<runs.length();j++) {
                    JSONObject run=runs.getJSONObject(j);if(!activation.optString("id").equals(run.optString("activationId")))continue;
                    if(last==null||time(run.optString("startedAt"))>time(last.optString("startedAt")))last=run;
                }
                if(last==null){last=newRun(block,activation,start(now,period,state),period,state);runs.put(last);changed=true;}
                for(int guard=0;guard<740;guard++) {
                    long deadline=time(last.optString("deadlineAt"));if(deadline<=0||deadline>now)break;
                    int required=0,requiredDone=0,completed=0;JSONArray children=last.getJSONArray("children");
                    evaluateChildren(last,state,deadline);
                    for(int j=0;j<children.length();j++) {
                        JSONObject c=children.getJSONObject(j);
                        if("DONE".equals(c.optString("status")))completed++;
                        if(c.optBoolean("required",true)){required++;if("DONE".equals(c.optString("status")))requiredDone++;}
                    }
                    if("IN_PROGRESS".equals(last.optString("status"))) {
                        JSONObject config=last.optJSONObject("blockSnapshot")==null?null:last.getJSONObject("blockSnapshot").optJSONObject("config");
                        String mode=config==null?"required_only":config.optString("completionMode","required_only");boolean threshold;
                        if("count".equals(mode))threshold=completed>=Math.max(1,config.optInt("completionValue",1));
                        else if("percentage".equals(mode))threshold=(children.length()==0?100d:completed*100d/children.length())>=Math.max(0,config.optDouble("completionValue",0));
                        else if("manual".equals(mode)||"open_ended".equals(mode))threshold=false;
                        else threshold=required==requiredDone;
                        String outcome=required==requiredDone&&threshold?"COMPLETED":"MISSED";
                        last.put("status",outcome).put("finishedAt",iso(deadline)).put("completionPercentage",children.length()==0?100d:completed*100d/children.length());
                        history(state,"run_"+outcome.toLowerCase(),deadline,new JSONObject().put("runId",last.getString("id"))
                            .put("blockId",block.getString("id")).put("completed",completed).put("required",required));
                    }
                    last=newRun(block,activation,deadline,period,state);runs.put(last);
                    history(state,"run_started",deadline,new JSONObject().put("runId",last.getString("id")).put("blockId",block.getString("id")));
                    changed=true;
                }
            }
            String before=state.getJSONArray("occurrences").toString();
            reconcileEntries(state,now);
            if(!before.equals(state.getJSONArray("occurrences").toString()))changed=true;
            if(changed){state.getJSONObject("meta").put("updatedAt",iso(now));
                if(context.getSharedPreferences("samt",Context.MODE_PRIVATE).edit().putString("state",state.toString()).commit())
                    Alarms.replaceFromState(context,state);
            }
        }catch(Exception ignored){}
    }
    @Override public void onReceive(Context context,Intent intent){reconcile(context);schedule(context);}
}
