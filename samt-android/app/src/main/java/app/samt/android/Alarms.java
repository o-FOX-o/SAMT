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
    public static void replaceFromState(Context context,JSONObject state) throws Exception {
        long now=System.currentTimeMillis();List<JSONObject> requests=new ArrayList<>();
        JSONArray occurrences=state.optJSONArray("occurrences");if(occurrences==null)return;
        for(int i=0;i<occurrences.length();i++) {
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
                    JSONObject state=new JSONObject(raw),o=null;JSONArray items=state.getJSONArray("occurrences");
                    for(int i=0;i<items.length();i++)if(occurrenceId.equals(items.getJSONObject(i).optString("id")))o=items.getJSONObject(i);
                    if(o==null)return;
                    String status=o.optString("status");
                    if(!"OPEN".equals(status)&&!"OVERDUE".equals(status)&&!"CARRIED".equals(status))return;
                    long now=System.currentTimeMillis(),until=now+600000;
                    o.put("snoozedUntil",java.time.Instant.ofEpochMilli(until).toString());
                    state.getJSONArray("history").put(new JSONObject().put("id","history_"+UUID.randomUUID())
                        .put("event","occurrence_snoozed").put("at",java.time.Instant.ofEpochMilli(now).toString())
                        .put("occurrenceId",occurrenceId).put("until",java.time.Instant.ofEpochMilli(until).toString()));
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
