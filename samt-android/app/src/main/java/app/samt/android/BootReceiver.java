package app.samt.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        BoundaryReceiver.reconcile(context);
        BoundaryReceiver.schedule(context);
        Alarms.restore(context);
    }
}
