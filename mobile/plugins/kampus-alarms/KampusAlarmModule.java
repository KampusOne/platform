package app.kampusone.alarms;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Context;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.net.Uri;
import android.provider.Settings;
import com.facebook.react.bridge.*;
import org.json.JSONArray;
import org.json.JSONObject;
public class KampusAlarmModule extends ReactContextBaseJavaModule {
  KampusAlarmModule(ReactApplicationContext context) { super(context); }
  static final String CHANGE_ACTION="app.kampusone.alarms.STATE_CHANGED";
  private BroadcastReceiver stateReceiver;
  @Override public void initialize() {
    super.initialize();
    stateReceiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){
      ReactApplicationContext react=getReactApplicationContext();
      if(react.hasActiveReactInstance())react.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("KampusAlarmStateChanged",null);
    }};
    IntentFilter filter=new IntentFilter(CHANGE_ACTION);
    if(android.os.Build.VERSION.SDK_INT>=33)getReactApplicationContext().registerReceiver(stateReceiver,filter,Context.RECEIVER_NOT_EXPORTED);
    else getReactApplicationContext().registerReceiver(stateReceiver,filter);
  }
  @Override public void invalidate(){
    if(stateReceiver!=null){try{getReactApplicationContext().unregisterReceiver(stateReceiver);}catch(IllegalArgumentException ignored){}stateReceiver=null;}
    super.invalidate();
  }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(double count) {}
  @ReactMethod public void eventSupport(Promise promise){promise.resolve(true);}
  @Override public String getName() { return "KampusAlarms"; }
  boolean alarmReady() {
    ReactApplicationContext context=getReactApplicationContext();
    if(!KampusAlarmScheduler.canSchedule(context))return false;
    return android.os.Build.VERSION.SDK_INT<34 || context.getSystemService(android.app.NotificationManager.class).canUseFullScreenIntent();
  }
  @ReactMethod public void status(Promise promise) { promise.resolve(alarmReady()); }
  @ReactMethod public void requestExactPermission(Promise promise) {
    try {
      if (!KampusAlarmScheduler.canSchedule(getReactApplicationContext()) && android.os.Build.VERSION.SDK_INT >= 31) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:"+getReactApplicationContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getReactApplicationContext().startActivity(intent);
      } else if (android.os.Build.VERSION.SDK_INT >= 34 && !getReactApplicationContext().getSystemService(android.app.NotificationManager.class).canUseFullScreenIntent()) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:"+getReactApplicationContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getReactApplicationContext().startActivity(intent);
      }
      promise.resolve(alarmReady());
    } catch(Exception e) { promise.reject("ALARM_PERMISSION", "Open Settings > Apps > Special app access > Alarms & reminders to enable KampusOne.", e); }
  }
  @ReactMethod public void sync(String json, Promise promise) {
    try { promise.resolve(KampusAlarmScheduler.sync(getReactApplicationContext(), new JSONArray(json))); }
    catch(Exception e) { promise.reject("ALARM_SYNC", e.getMessage(), e); }
  }
  @ReactMethod public void dismiss(String id, Promise promise) { KampusAlarmService.command(getReactApplicationContext(), "dismiss", id); promise.resolve(true); }
  @ReactMethod public void snooze(String id, Promise promise) { KampusAlarmService.command(getReactApplicationContext(), "snooze", id); promise.resolve(true); }
  @ReactMethod public void snoozeFor(String id, int minutes, Promise promise) { KampusAlarmService.command(getReactApplicationContext(), "snooze", id, minutes); promise.resolve(true); }
  @ReactMethod public void active(Promise promise) { promise.resolve(KampusAlarmScheduler.prefs(getReactApplicationContext()).getString("active", null)); }
  @ReactMethod public void events(Promise promise) { promise.resolve(KampusAlarmScheduler.prefs(getReactApplicationContext()).getString("events", "[]")); }
  @ReactMethod public void acknowledge(String ids, Promise promise) {
    try { synchronized(KampusAlarmScheduler.class) {
      JSONArray remove=new JSONArray(ids),events=new JSONArray(KampusAlarmScheduler.prefs(getReactApplicationContext()).getString("events","[]")),keep=new JSONArray();
      for(int i=0;i<events.length();i++){JSONObject item=events.getJSONObject(i);boolean found=false;for(int j=0;j<remove.length();j++)if(item.getString("id").equals(remove.getString(j)))found=true;if(!found)keep.put(item);}
      KampusAlarmScheduler.prefs(getReactApplicationContext()).edit().putString("events",keep.toString()).apply();
    } promise.resolve(true); }catch(Exception e){promise.reject("ALARM_EVENTS", e);}
  }
  @ReactMethod public void cacheSound(String url, Promise promise) {
    new Thread(() -> { try { KampusAlarmScheduler.cacheSound(getReactApplicationContext(),url); promise.resolve(true); } catch(Exception e) { promise.reject("ALARM_SOUND",e); } },"kampus-alarm-sound").start();
  }
  @ReactMethod public void cacheAlarmSound(String id, String url, Promise promise) {
    new Thread(() -> { try { KampusAlarmScheduler.cacheAlarmSound(getReactApplicationContext(),id,url); promise.resolve(true); } catch(Exception e) { promise.reject("ALARM_SOUND",e); } },"kampus-alarm-user-sound").start();
  }
}
