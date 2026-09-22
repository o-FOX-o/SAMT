package app.samt.android;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public final class Alarms {
    private static final String CHANNEL="samt_reminders";
    private Alarms() {}
    public static void channel(Context context) {
        NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        if(Build.VERSION.SDK_INT>=26&&!manager.getNotificationChannels().stream().anyMatch(c->CHANNEL.equals(c.getId()))) {
            NotificationChannel ch=new NotificationChannel(CHANNEL,"SAMT alarms and reminders",NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Scheduled items you choose in SAMT");ch.enableVibration(true);manager.createNotificationChannel(ch);
        }
    }
    private static PendingIntent intent(Context context,String id,String title,String body,String kind,int flags) {
        Intent i=new Intent(context,AlarmReceiver.class).setAction("app.samt.ALARM")
            .setData(Uri.parse("samt://alarm/"+Uri.encode(id)))
            .putExtra("id",id).putExtra("title",title).putExtra("body",body).putExtra("kind",kind);
        return PendingIntent.getBroadcast(context,0,i,flags|PendingIntent.FLAG_IMMUTABLE);
    }
    public static void replaceAll(Context context,String json) throws Exception {
        JSONArray next=new JSONArray(json);
        if(next.length()>250)throw new IllegalArgumentException("Too many alarms.");
        JSONArray old=new JSONArray(context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("alarms","[]"));
        AlarmManager alarm=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        for(int i=0;i<old.length();i++) {
            JSONObject x=old.getJSONObject(i);PendingIntent pending=intent(context,x.getString("id"),"","","",PendingIntent.FLAG_NO_CREATE);
            if(pending!=null){alarm.cancel(pending);pending.cancel();}
        }
        context.getSharedPreferences("samt",Context.MODE_PRIVATE).edit().putString("alarms",json).apply();
        schedule(context,next);
    }
    public static void restore(Context context) {
        try {schedule(context,new JSONArray(context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("alarms","[]")));}
        catch(Exception ignored) {}
    }
    public static boolean test(Context context,long delayMillis) throws Exception {
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;
        channel(context);long at=System.currentTimeMillis()+Math.max(3_000,delayMillis);
        String id="test-"+at;PendingIntent pending=intent(context,id,"SAMT test alarm","Alarms are working on this phone","alarm",PendingIntent.FLAG_UPDATE_CURRENT);
        AlarmManager manager=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        try {
            if(Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms())manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);
        }catch(SecurityException e){manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);}
        return true;
    }
    public static void replaceFromState(Context context,JSONObject state) throws Exception {
        long now=System.currentTimeMillis();List<JSONObject> requests=new ArrayList<>();
        JSONArray occurrences=state.optJSONArray("occurrences");
        if(occurrences!=null)for(int i=0;i<occurrences.length();i++) {
            JSONObject o=occurrences.getJSONObject(i);String status=o.optString("status");
            if(!"OPEN".equals(status)&&!"OVERDUE".equals(status)&&!"CARRIED".equals(status))continue;
            JSONObject e=o.optJSONObject("entrySnapshot"),item=o.optJSONObject("itemSnapshot");if(e==null)continue;
            long due=androidTime(o.optString("dueAt"));String title=item==null?e.optString("name","SAMT reminder"):item.optString("name",e.optString("name","SAMT reminder"));
            JSONArray minutes=e.optJSONArray("reminderMinutes");
            if(minutes!=null)for(int j=0;j<minutes.length();j++) {
                long when=due-(long)(minutes.optDouble(j,0)*60000);
                if(when>now)requests.add(new JSONObject().put("id",o.getString("id")+":"+minutes.optString(j))
                    .put("at",when).put("title",title).put("body","Upcoming in SAMT").put("kind","reminder"));
            }
            long alarm=o.isNull("snoozedUntil")?due:androidTime(o.optString("snoozedUntil"));
            if(e.optBoolean("alarm")&&alarm>now)requests.add(new JSONObject().put("id",o.getString("id")+":alarm")
                .put("at",alarm).put("title",title).put("body","Your SAMT alarm is due").put("kind","alarm"));
        }
        JSONArray runs=state.optJSONArray("runs");
        if(runs!=null)for(int i=0;i<runs.length();i++) {
            JSONObject run=runs.getJSONObject(i);String runStatus=run.optString("status");
            if(!"IN_PROGRESS".equals(runStatus)&&!"READY_TO_FINISH".equals(runStatus)&&!"OVERDUE".equals(runStatus))continue;
            JSONArray children=run.optJSONArray("children");if(children==null)continue;
            for(int j=0;j<children.length();j++) {
                JSONObject child=children.getJSONObject(j),config=child.optJSONObject("config"),snapshot=child.optJSONObject("definitionSnapshot");
                if(!"OPEN".equals(child.optString("status"))||config==null||child.isNull("dueAt"))continue;
                long due=androidTime(child.optString("dueAt"));String title=snapshot==null?"SAMT reminder":snapshot.optString("name","SAMT reminder");
                JSONArray minutes=config.optJSONArray("reminderMinutes");
                if(minutes!=null)for(int k=0;k<minutes.length();k++) {
                    long when=due-(long)(minutes.optDouble(k,0)*60000);
                    if(when>now)requests.add(new JSONObject().put("id",child.getString("id")+":"+minutes.optString(k))
                        .put("at",when).put("title",title).put("body","Upcoming in "+run.optJSONObject("blockSnapshot").optString("name","SAMT")).put("kind","reminder"));
                }
                long alarm=child.isNull("snoozedUntil")?due:androidTime(child.optString("snoozedUntil"));
                if(config.optBoolean("alarm")&&alarm>now)requests.add(new JSONObject().put("id",child.getString("id")+":alarm")
                    .put("at",alarm).put("title",title).put("body","Due in "+run.optJSONObject("blockSnapshot").optString("name","SAMT")).put("kind","alarm"));
            }
        }
        requests.sort(Comparator.comparingLong(x->x.optLong("at")));
        JSONArray next=new JSONArray();for(int i=0;i<Math.min(250,requests.size());i++)next.put(requests.get(i));
        replaceAll(context,next.toString());
    }
    private static long androidTime(String value) {try{return java.time.Instant.parse(value).toEpochMilli();}catch(Exception e){return 0;}}
    private static void schedule(Context context,JSONArray list) throws Exception {
        AlarmManager manager=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        for(int i=0;i<list.length();i++) {
            JSONObject x=list.getJSONObject(i);long at=x.getLong("at");if(at<=System.currentTimeMillis())continue;
            PendingIntent pending=intent(context,x.getString("id"),x.optString("title","SAMT"),
                x.optString("body","Scheduled item"),x.optString("kind","reminder"),PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                if(Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms())manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);
                else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);
            }catch(SecurityException e){manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pending);}
        }
    }
    public static class AlarmReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context,Intent intent) {
            if("app.samt.SNOOZE".equals(intent.getAction())){
                try {
                    String id=intent.getStringExtra("id");if(id==null)return;
                    String occurrenceId=id.split(":",2)[0];
                    String raw=context.getSharedPreferences("samt",Context.MODE_PRIVATE).getString("state","");
                    JSONObject state=new JSONObject(raw),o=null,child=null,ownerRun=null;JSONArray items=state.getJSONArray("occurrences");
                    for(int i=0;i<items.length();i++)if(occurrenceId.equals(items.getJSONObject(i).optString("id")))o=items.getJSONObject(i);
                    if(o==null){JSONArray runs=state.optJSONArray("runs");if(runs!=null)for(int i=0;i<runs.length();i++){
                        JSONObject run=runs.getJSONObject(i);JSONArray children=run.optJSONArray("children");if(children==null)continue;
                        for(int j=0;j<children.length();j++)if(occurrenceId.equals(children.getJSONObject(j).optString("id"))){child=children.getJSONObject(j);ownerRun=run;}
                    }}
                    JSONObject target=o!=null?o:child;if(target==null)return;
                    String status=target.optString("status");
                    if(!"OPEN".equals(status)&&!"OVERDUE".equals(status)&&!"CARRIED".equals(status))return;
                    long now=System.currentTimeMillis(),until=now+600000;
                    target.put("snoozedUntil",java.time.Instant.ofEpochMilli(until).toString());
                    JSONObject event=new JSONObject().put("id","history_"+UUID.randomUUID())
                        .put("event",o!=null?"occurrence_snoozed":"run_child_snoozed").put("at",java.time.Instant.ofEpochMilli(now).toString())
                        .put(o!=null?"occurrenceId":"childId",occurrenceId).put("until",java.time.Instant.ofEpochMilli(until).toString());
                    if(ownerRun!=null)event.put("runId",ownerRun.optString("id"));state.getJSONArray("history").put(event);
                    state.getJSONObject("meta").put("updatedAt",java.time.Instant.ofEpochMilli(now).toString());
                    if(context.getSharedPreferences("samt",Context.MODE_PRIVATE).edit().putString("state",state.toString()).commit())
                        replaceFromState(context,state);
                    ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id.hashCode());
                }catch(Exception ignored){}
                return;
            }
            if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
            channel(context);
            String id=intent.getStringExtra("id"),kind=intent.getStringExtra("kind");
            Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder=new Notification.Builder(context,CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setContentIntent(content).setAutoCancel(true)
                .setCategory("alarm".equals(kind)?Notification.CATEGORY_ALARM:Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE);
            if("alarm".equals(kind)&&id!=null){
                Intent snooze=new Intent(context,AlarmReceiver.class).setAction("app.samt.SNOOZE")
                    .setData(Uri.parse("samt://snooze/"+Uri.encode(id))).putExtra("id",id);
                PendingIntent snoozePending=PendingIntent.getBroadcast(context,0,snooze,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                builder.addAction(new Notification.Action.Builder(R.drawable.ic_notification,"Snooze 10 min",snoozePending).build());
            }
            Notification notification=builder.build();
            NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify(id==null?1:id.hashCode(),notification);
        }
    }
}
