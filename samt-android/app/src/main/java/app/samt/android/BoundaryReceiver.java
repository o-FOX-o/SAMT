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
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;

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
            children.put(new JSONObject().put("id",id("child")).put("relationshipId",rel.getString("id"))
                .put("kind",rel.getString("kind")).put("refId",rel.getString("refId"))
                .put("required",rel.optBoolean("required",true)).put("status","OPEN")
                .put("definitionSnapshot",source==null?JSONObject.NULL:new JSONObject(source.toString())));
        }
        return run.put("children",children);
    }
    private static void history(JSONObject state,String event,long at,JSONObject details) throws Exception {
        JSONObject row=new JSONObject().put("id",id("history")).put("event",event).put("at",iso(at));
        for(String key:details.keySet())row.put(key,details.get(key));state.getJSONArray("history").put(row);
    }
    public static void reconcile(Context context) {
        String raw=context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("state","");
        if(raw.isEmpty())return;
        try {
            JSONObject state=new JSONObject(raw);if(state.optInt("schemaVersion")!=3)return;
            JSONArray activations=state.getJSONArray("activations"),blocks=state.getJSONArray("blocks"),runs=state.getJSONArray("runs");
            long now=System.currentTimeMillis();boolean changed=false;
            for(int i=0;i<activations.length();i++) {
                JSONObject activation=activations.getJSONObject(i);
                if(!"ACTIVE".equals(activation.optString("status")))continue;
                String period=activation.optJSONObject("schedule")==null?"manual":activation.getJSONObject("schedule").optString("period","manual");
                if(!"daily".equals(period)&&!"weekly".equals(period))continue;
                JSONObject block=null;
                for(int j=0;j<blocks.length();j++)if(activation.optString("blockId").equals(blocks.getJSONObject(j).optString("id")))block=blocks.getJSONObject(j);
                if(block==null||!"routine".equals(block.optString("type")))continue;
                JSONObject last=null;
                for(int j=0;j<runs.length();j++) {
                    JSONObject run=runs.getJSONObject(j);if(!activation.optString("id").equals(run.optString("activationId")))continue;
                    if(last==null||time(run.optString("startedAt"))>time(last.optString("startedAt")))last=run;
                }
                if(last==null){last=newRun(block,activation,start(now,period,state),period,state);runs.put(last);changed=true;}
                for(int guard=0;guard<740;guard++) {
                    long deadline=time(last.optString("deadlineAt"));if(deadline<=0||deadline>now)break;
                    int required=0,done=0;JSONArray children=last.getJSONArray("children");
                    for(int j=0;j<children.length();j++) {
                        JSONObject c=children.getJSONObject(j);
                        if(c.optBoolean("required",true)){required++;if("DONE".equals(c.optString("status")))done++;}
                    }
                    if("IN_PROGRESS".equals(last.optString("status"))) {
                        String outcome=required==done?"COMPLETED":"MISSED";
                        last.put("status",outcome).put("finishedAt",iso(deadline));
                        history(state,"run_"+outcome.toLowerCase(),deadline,new JSONObject().put("runId",last.getString("id"))
                            .put("blockId",block.getString("id")).put("completed",done).put("required",required));
                    }
                    last=newRun(block,activation,deadline,period,state);runs.put(last);
                    history(state,"run_started",deadline,new JSONObject().put("runId",last.getString("id")).put("blockId",block.getString("id")));
                    changed=true;
                }
            }
            if(changed){state.getJSONObject("meta").put("updatedAt",iso(now));
                context.getSharedPreferences("samt",Context.MODE_PRIVATE).edit().putString("state",state.toString()).commit();}
        }catch(Exception ignored){}
    }
    @Override public void onReceive(Context context,Intent intent){reconcile(context);schedule(context);}
}
