package app.kampusone.alarms;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import org.json.*;
import java.util.*;
import java.io.*;
import java.net.*;
class KampusAlarmScheduler {
  static SharedPreferences prefs(Context c) { return c.getSharedPreferences("kampus-alarms-v1",Context.MODE_PRIVATE); }
  static boolean canSchedule(Context c) { return Build.VERSION.SDK_INT<31 || ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms(); }
  static PendingIntent pending(Context c,String id) { Intent intent=new Intent(c,KampusAlarmReceiver.class).setAction("kampusone.ALARM").setData(Uri.parse("kampusone://scheduled-alarm/"+id)).putExtra("alarmId",id);return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE); }
  static PendingIntent open(Context c,String id) { Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse("kampusone://alarm-ring?alarmId="+Uri.encode(id))).setPackage(c.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP); return PendingIntent.getActivity(c,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE); }
  static long next(JSONObject alarm,long now) throws Exception {
    JSONArray days=alarm.optJSONArray("days");
    if(days==null || days.length()==0) { String at=alarm.optString("fires_at");try { java.text.SimpleDateFormat parser=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",Locale.US);return parser.parse(at.replaceAll("\\.[0-9]+", "")).getTime(); } catch(Exception e) {return -1;} }
    String[] clock=alarm.getString("time").split(":"); Calendar date=Calendar.getInstance(TimeZone.getTimeZone("Africa/Lagos"));date.setTimeInMillis(now);date.set(Calendar.HOUR_OF_DAY,Integer.parseInt(clock[0]));date.set(Calendar.MINUTE,Integer.parseInt(clock[1]));date.set(Calendar.SECOND,0);date.set(Calendar.MILLISECOND,0);
    for(int offset=0;offset<=7;offset++){int day=date.get(Calendar.DAY_OF_WEEK)-1;for(int i=0;i<days.length();i++)if(days.getInt(i)==day&&date.getTimeInMillis()>now)return date.getTimeInMillis();date.add(Calendar.DATE,1);}return -1;
  }
  static boolean schedule(Context c,String id,long when) {
    if(when<=System.currentTimeMillis())return false;
    AlarmManager manager=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    PendingIntent alarmIntent=pending(c,id);
    try {
      if(canSchedule(c)){
        manager.setAlarmClock(new AlarmManager.AlarmClockInfo(when,open(c,id)),alarmIntent);
        android.util.Log.i("KampusAlarms","Scheduled exact alarm "+id+" at "+when);
      } else {
        // Android 14+ denies SCHEDULE_EXACT_ALARM by default on many fresh installs.
        // Never silently drop the user's alarm: keep a wake-up fallback registered
        // while the app guides the user to enable exact alarm access.
        if(Build.VERSION.SDK_INT>=23)manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,alarmIntent);
        else manager.set(AlarmManager.RTC_WAKEUP,when,alarmIntent);
        android.util.Log.w("KampusAlarms","Exact alarm access unavailable; scheduled wake-up fallback for "+id);
      }
      return true;
    } catch(SecurityException denied) {
      // Permission can be revoked between canScheduleExactAlarms() and registration.
      try {
        if(Build.VERSION.SDK_INT>=23)manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,alarmIntent);
        else manager.set(AlarmManager.RTC_WAKEUP,when,alarmIntent);
        android.util.Log.w("KampusAlarms","Exact alarm permission changed; fallback registered for "+id,denied);
        return true;
      } catch(Exception fallbackError) {
        android.util.Log.e("KampusAlarms","Unable to register alarm "+id,fallbackError);
        return false;
      }
    } catch(Exception error) {
      android.util.Log.e("KampusAlarms","Unable to register alarm "+id,error);
      return false;
    }
  }
  static synchronized void sync(Context c,JSONArray alarms) throws Exception {
    if(alarms.length()>150)throw new IllegalArgumentException("Too many alarms");
    JSONObject previous=new JSONObject(prefs(c).getString("alarms","{}")),next=new JSONObject();
    for(int i=0;i<alarms.length();i++){JSONObject item=alarms.getJSONObject(i);if(item.optBoolean("enabled"))next.put(item.getString("id"),item);}
    AlarmManager manager=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
    Iterator<String> old=previous.keys();while(old.hasNext()){String id=old.next();if(!next.has(id)){manager.cancel(pending(c,id));manager.cancel(pending(c,id+"~snooze"));}}
    prefs(c).edit().putString("alarms",next.toString()).apply();
    // Re-register even unchanged alarms: Android can remove pending alarms when
    // permission changes or the app is updated. setAlarmClock replaces by ID.
    Iterator<String> keys=next.keys();while(keys.hasNext()){String id=keys.next();JSONObject item=next.getJSONObject(id);schedule(c,id,next(item,System.currentTimeMillis()));}
  }
  static void restore(Context c) throws Exception { JSONObject alarms=new JSONObject(prefs(c).getString("alarms","{}"));Iterator<String> keys=alarms.keys();while(keys.hasNext()){String id=keys.next();schedule(c,id,next(alarms.getJSONObject(id),System.currentTimeMillis()));}long snooze=prefs(c).getLong("snoozeAt",0);String id=prefs(c).getString("snoozeId",null);if(id!=null&&alarms.has(id))schedule(c,id+"~snooze",snooze); }
  static JSONObject alarm(Context c,String id) throws Exception { return new JSONObject(prefs(c).getString("alarms","{}")).optJSONObject(id.replace("~snooze","")); }
  static synchronized void record(Context c,JSONObject alarm,String kind,long firedAt){try{JSONArray all=new JSONArray(prefs(c).getString("events","[]")),out=new JSONArray();for(int i=Math.max(0,all.length()-99);i<all.length();i++)out.put(all.getJSONObject(i));out.put(new JSONObject().put("id",UUID.randomUUID().toString()).put("alarmId",alarm.getString("id")).put("kind",kind).put("firedAt",iso(firedAt)));prefs(c).edit().putString("events",out.toString()).apply();}catch(Exception ignored){}}
  static String iso(long time){java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.format(new Date(time));}
  static void cacheSound(Context c,String url) throws Exception {
    if(url==null||url.isEmpty()){prefs(c).edit().remove("soundFile").remove("soundUrl").apply();return;}
    if(url.equals(prefs(c).getString("soundUrl",""))&&new File(c.getFilesDir(),"alarm-tone.bin").exists())return;
    URL source=new URL(url);if(!source.getProtocol().equals("https"))throw new IOException("Alarm sound must use HTTPS");
    HttpURLConnection connection=(HttpURLConnection)source.openConnection();connection.setConnectTimeout(8000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);
    File temp=new File(c.getFilesDir(),"alarm-tone-download.bin"),target=new File(c.getFilesDir(),"alarm-tone.bin");
    try { if(connection.getResponseCode()!=200)throw new IOException("Alarm sound unavailable");try(InputStream input=connection.getInputStream();OutputStream output=new FileOutputStream(temp)){byte[] buffer=new byte[8192];int count,total=0;while((count=input.read(buffer))!=-1){total+=count;if(total>10*1024*1024)throw new IOException("Alarm sound exceeds 10 MB");output.write(buffer,0,count);}}if(!temp.renameTo(target))throw new IOException("Cannot save alarm sound");prefs(c).edit().putString("soundFile",target.getAbsolutePath()).putString("soundUrl",url).apply(); }
    finally {connection.disconnect();temp.delete();}
  }
}
