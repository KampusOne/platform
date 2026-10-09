package app.kampusone.alarms;
import android.content.*;
import android.os.Build;
import org.json.JSONObject;
public class KampusAlarmReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context,Intent intent) {
    String id=intent.getStringExtra("alarmId");if(id==null)return;
    try { JSONObject alarm=KampusAlarmScheduler.alarm(context,id);if(alarm==null)return;
      if(!id.endsWith("~snooze"))KampusAlarmScheduler.schedule(context,id,KampusAlarmScheduler.next(alarm,System.currentTimeMillis()+1000));
      else KampusAlarmScheduler.prefs(context).edit().remove("snoozeAt").remove("snoozeId").apply();
      // Suppress stale broadcasts and snoozes if the student muted this Lagos day.
      if(KampusAlarmScheduler.mutedForDay(alarm,System.currentTimeMillis()))return;
      Intent service=new Intent(context,KampusAlarmService.class).setAction("ring").putExtra("alarm",alarm.toString());
      if(Build.VERSION.SDK_INT>=26)context.startForegroundService(service);else context.startService(service);
    } catch(Exception error) { android.util.Log.e("KampusAlarms","Alarm start failed",error); }
  }
}
