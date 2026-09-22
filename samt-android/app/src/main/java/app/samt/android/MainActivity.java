package app.samt.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int OPEN_JSON=405, SAVE_JSON=406, NOTIFICATION_REQUEST=407;
    private WebView web;
    private String pendingExport;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(17,28,53));
        getWindow().setNavigationBarColor(Color.rgb(17,28,53));
        web=new WebView(this);
        web.setBackgroundColor(Color.rgb(244,246,250));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        final WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {return loader.shouldInterceptRequest(request.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                return !"appassets.androidplatform.net".equals(request.getUrl().getHost());
            }
        });
        web.addJavascriptInterface(new PhoneBridge(),"SamtAndroid");
        setContentView(web);
        Alarms.channel(this);
        BoundaryReceiver.schedule(this);
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }
    @Override protected void onResume() {
        super.onResume();
        if(web!=null)web.evaluateJavascript("window.SamtResume && window.SamtResume()",null);
    }
    @Override public void onBackPressed() {
        if(web==null){super.onBackPressed();return;}
        web.evaluateJavascript("window.SamtBack ? window.SamtBack() : false",value->{
            if(!"true".equals(value))MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy() {
        if(web!=null){web.removeJavascriptInterface("SamtAndroid");web.destroy();web=null;}
        super.onDestroy();
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(result!=RESULT_OK||data==null||data.getData()==null)return;
        try {
            if(request==SAVE_JSON&&pendingExport!=null) {
                try(OutputStream stream=getContentResolver().openOutputStream(data.getData())) {
                    if(stream==null)throw new Exception("File could not be opened.");
                    stream.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                }
                pendingExport=null;
            }
            if(request==OPEN_JSON) {
                try(InputStream stream=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                    if(stream==null)throw new Exception("Backup could not be opened.");
                    byte[] chunk=new byte[8192];int n;
                    while((n=stream.read(chunk))!=-1){out.write(chunk,0,n);if(out.size()>20_000_000)throw new Exception("Backup exceeds 20 MB.");}
                    String json=new String(out.toByteArray(),StandardCharsets.UTF_8);
                    web.evaluateJavascript("window.SamtReceiveImport("+JSONObject.quote(json)+")",null);
                }
            }
        } catch(Exception e) { web.evaluateJavascript("window.SamtFileError("+JSONObject.quote(e.getMessage())+")",null); }
    }
    public class PhoneBridge {
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(),0).versionName; }
            catch(Exception ignored) { return "preview"; }
        }
        @JavascriptInterface public String loadState() {
            return getSharedPreferences("samt",MODE_PRIVATE).getString("state","");
        }
        @JavascriptInterface public boolean saveState(String json) {
            try {new JSONObject(json);boolean saved=getSharedPreferences("samt",MODE_PRIVATE).edit().putString("state",json).commit();if(saved)BoundaryReceiver.schedule(MainActivity.this);return saved;}
            catch(Exception e){return false;}
        }
        @JavascriptInterface public boolean scheduleAlarms(String json) {
            try {Alarms.replaceAll(MainActivity.this,json);return true;}catch(Exception ignored){return false;}
        }
        @JavascriptInterface public boolean testAlarm() {
            try {return Alarms.test(MainActivity.this,10_000);}catch(Exception ignored){return false;}
        }
        @JavascriptInterface public void exportFile(String filename,String mime,String content) {
            runOnUiThread(()->{
                pendingExport=content;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE,filename);
                startActivityForResult(intent,SAVE_JSON);
            });
        }
        @JavascriptInterface public void importFile() {
            runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),OPEN_JSON));
        }
        @JavascriptInterface public String permissions() {
            AlarmManager manager=(AlarmManager)getSystemService(Context.ALARM_SERVICE);
            boolean exact=Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms();
            NotificationManager notificationsManager=(NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
            boolean runtime=Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
            boolean notifications=runtime&&(Build.VERSION.SDK_INT<24||notificationsManager.areNotificationsEnabled());
            boolean channel=Build.VERSION.SDK_INT<26||notificationsManager.getNotificationChannel("samt_reminders")==null||
                notificationsManager.getNotificationChannel("samt_reminders").getImportance()!=NotificationManager.IMPORTANCE_NONE;
            int scheduled=0;long nextAt=0;
            try {
                org.json.JSONArray alarms=new org.json.JSONArray(getSharedPreferences("samt",MODE_PRIVATE).getString("alarms","[]"));
                scheduled=alarms.length();for(int i=0;i<alarms.length();i++){long at=alarms.getJSONObject(i).optLong("at");if(at>0&&(nextAt==0||at<nextAt))nextAt=at;}
            }catch(Exception ignored){}
            return "{\"exact\":"+exact+",\"notifications\":"+notifications+",\"channel\":"+channel+
                ",\"scheduled\":"+scheduled+",\"nextAt\":"+nextAt+"}";
        }
        @JavascriptInterface public void requestAlarmPermission() {
            if(Build.VERSION.SDK_INT<31)return;
            runOnUiThread(()->startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:"+getPackageName()))));
        }
        @JavascriptInterface public void requestNotifications() {
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                runOnUiThread(()->requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_REQUEST));
            else runOnUiThread(()->startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName())));
        }
    }
}
