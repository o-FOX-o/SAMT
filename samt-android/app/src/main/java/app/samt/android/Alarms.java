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
            if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
            channel(context);
            String id=intent.getStringExtra("id"),kind=intent.getStringExtra("kind");
            Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification notification=new Notification.Builder(context,CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setContentIntent(content).setAutoCancel(true)
                .setCategory("alarm".equals(kind)?Notification.CATEGORY_ALARM:Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE).build();
            NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify(id==null?1:id.hashCode(),notification);
        }
    }
}
