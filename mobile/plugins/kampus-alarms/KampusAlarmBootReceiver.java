package app.kampusone.alarms;
import android.content.*;
public class KampusAlarmBootReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context,Intent intent) {
    try { KampusAlarmScheduler.restore(context); }catch(Exception error){android.util.Log.e("KampusAlarms","Alarm restore failed",error);}
  }
}
