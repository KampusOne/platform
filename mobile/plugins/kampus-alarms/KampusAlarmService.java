package app.kampusone.alarms;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.net.Uri;
import android.os.*;
import org.json.JSONObject;
import java.io.File;
public class KampusAlarmService extends Service {
  static final String CHANNEL="kampusone-ringing-v1",MISSED="kampusone-missed-v1";
  static final int NOTIFICATION_ID=73410;
  final Handler handler=new Handler(Looper.getMainLooper());
  MediaPlayer player; Vibrator vibrator; PowerManager.WakeLock wakeLock; JSONObject alarm;long firedAt;
  public static void command(Context c,String action,String id) { Intent intent=new Intent(c,KampusAlarmService.class).setAction(action).putExtra("alarmId",id);try{c.startService(intent);}catch(Exception e){android.util.Log.w("KampusAlarms","Alarm action unavailable",e);} }
  @Override public IBinder onBind(Intent intent){return null;}
  PendingIntent action(String command){Intent intent=new Intent(this,KampusAlarmService.class).setAction(command).putExtra("alarmId",alarm.optString("id"));return PendingIntent.getService(this,command.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  void channels(){if(Build.VERSION.SDK_INT>=26){NotificationManager manager=getSystemService(NotificationManager.class);NotificationChannel ring=new NotificationChannel(CHANNEL,"Ringing alarms",NotificationManager.IMPORTANCE_HIGH);ring.setDescription("Dismiss or snooze your KampusOne alarm");ring.setSound(null,null);ring.enableVibration(false);manager.createNotificationChannel(ring);manager.createNotificationChannel(new NotificationChannel(MISSED,"Missed alarms",NotificationManager.IMPORTANCE_DEFAULT));}}
  Notification.Builder builder(String channel){return Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);}
  @Override public int onStartCommand(Intent intent,int flags,int startId){
    if(intent==null){stopSelf();return START_NOT_STICKY;}
    String action=intent.getAction();
    if("dismiss".equals(action)||"snooze".equals(action)){
      if(alarm!=null&&alarm.optString("id").equals(intent.getStringExtra("alarmId"))){
        if("snooze".equals(action)){long at=System.currentTimeMillis()+Math.max(1,Math.min(30,alarm.optInt("snooze_minutes",5)))*60000L;KampusAlarmScheduler.prefs(this).edit().putString("snoozeId",alarm.optString("id")).putLong("snoozeAt",at).apply();KampusAlarmScheduler.schedule(this,alarm.optString("id")+"~snooze",at);}
        finish(action);
      } else if(alarm==null)stopSelf();
      return START_NOT_STICKY;
    }
    try {
      JSONObject incoming=new JSONObject(intent.getStringExtra("alarm"));
      if(alarm!=null){KampusAlarmScheduler.record(this,alarm,"missed",firedAt);stopAudio();handler.removeCallbacksAndMessages(null);}
      alarm=incoming;firedAt=System.currentTimeMillis();channels();
      String title=alarm.optString("label","KampusOne alarm");
      Intent screen = new Intent(this,KampusAlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent ringScreen = PendingIntent.getActivity(this,73411,screen,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      Notification notification=builder(CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(title).setContentText("Time for your reminder · tap to open").setCategory(Notification.CATEGORY_ALARM).setOngoing(true).setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(ringScreen).setFullScreenIntent(ringScreen,true).addAction(new Notification.Action.Builder(null,"Snooze",action("snooze")).build()).addAction(new Notification.Action.Builder(null,"Dismiss",action("dismiss")).build()).build();
      if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(NOTIFICATION_ID,notification);
      JSONObject active=new JSONObject(alarm.toString()).put("firedAt",firedAt).put("endsAt",firedAt+180000);KampusAlarmScheduler.prefs(this).edit().putString("active",active.toString()).apply();
      KampusAlarmScheduler.record(this,alarm,"ringing",firedAt);
      wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"KampusOne:alarm");wakeLock.acquire(185000);
      if(!alarm.optString("sound","default").equals("silent"))play();
      if(alarm.optBoolean("vibration",true)){vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(vibrator!=null){long[] pattern=new long[]{0,600,400,600,1000};if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(VibrationEffect.createWaveform(pattern,0));else vibrator.vibrate(pattern,0);}}
      handler.postDelayed(()->finish("missed"),180000);
    }catch(Exception e){android.util.Log.e("KampusAlarms","Unable to ring",e);finish("missed");}
    return START_NOT_STICKY;
  }
  void play(){
    try {
      String file=KampusAlarmScheduler.prefs(this).getString("soundFile","");Uri uri=!file.isEmpty()&&new File(file).exists()?Uri.fromFile(new File(file)):RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);if(uri==null)uri=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());player.setDataSource(this,uri);player.setLooping(true);player.setOnErrorListener((mp,what,extra)->{android.util.Log.w("KampusAlarms","Alarm audio error "+what);return true;});player.prepare();player.start();
    }catch(Exception e){android.util.Log.w("KampusAlarms","Custom tone unavailable; using device alarm",e);try{if(player!=null)player.release();player=MediaPlayer.create(this,RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));if(player!=null){player.setLooping(true);player.start();}}catch(Exception ignored){}}
  }
  void finish(String outcome){
    handler.removeCallbacksAndMessages(null);stopAudio();
    if(alarm!=null){KampusAlarmScheduler.record(this,alarm,outcome,firedAt);if("missed".equals(outcome)){channels();Notification notice=builder(MISSED).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("Missed alarm: "+alarm.optString("label","Reminder")).setContentText("Your alarm rang for three minutes. Check your timetable for what is next.").setAutoCancel(true).setContentIntent(KampusAlarmScheduler.open(this,alarm.optString("id"))).build();getSystemService(NotificationManager.class).notify(alarm.optString("id").hashCode(),notice);}}
    alarm=null;KampusAlarmScheduler.prefs(this).edit().remove("active").apply();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
  }
  void stopAudio(){if(player!=null){try{player.stop();}catch(Exception ignored){}player.release();player=null;}if(vibrator!=null)vibrator.cancel();if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();}
  @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);stopAudio();KampusAlarmScheduler.prefs(this).edit().remove("active").apply();super.onDestroy();}
}
