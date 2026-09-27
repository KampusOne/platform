package app.kampusone.alarms;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;

/** Ring controls must work on a locked phone before the React app has loaded. */
public class KampusAlarmActivity extends Activity {
  final Handler handler = new Handler(Looper.getMainLooper());
  String alarmId;
  TextView title, remaining;
  final Runnable refresh = new Runnable() {
    @Override public void run() {
      try {
        String value = KampusAlarmScheduler.prefs(KampusAlarmActivity.this).getString("active", null);
        if (value == null) { finish(); return; }
        JSONObject active = new JSONObject(value);
        alarmId = active.getString("id");
        title.setText(active.optString("label", "KampusOne alarm"));
        long seconds = Math.max(0, (active.optLong("endsAt") - System.currentTimeMillis() + 999) / 1000);
        remaining.setText(String.format(java.util.Locale.getDefault(), "%d:%02d remaining", seconds / 60, seconds % 60));
        if (seconds == 0) { finish(); return; }
        handler.postDelayed(this, 500);
      } catch (Exception e) { finish(); }
    }
  };
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setGravity(Gravity.CENTER);
    layout.setPadding(32, 64, 32, 64);
    layout.setBackgroundColor(Color.rgb(251,247,242));
    TextView brand = new TextView(this); brand.setText("KampusOne · Alarm"); brand.setTextSize(18); brand.setTextColor(Color.rgb(168,70,46));
    layout.addView(brand);
    title = new TextView(this); title.setTextSize(34); title.setTextColor(Color.rgb(41,35,31)); title.setGravity(Gravity.CENTER); title.setPadding(0,40,0,24);
    layout.addView(title);
    remaining = new TextView(this); remaining.setTextSize(18); remaining.setPadding(0,0,0,36); remaining.setTextColor(Color.rgb(83,68,59));
    layout.addView(remaining);
    for (String command : new String[]{"snooze", "dismiss"}) {
      Button button = new Button(this);
      button.setText(command.equals("snooze") ? "Snooze" : "Dismiss alarm");
      button.setTextSize(18); button.setAllCaps(false); button.setMinHeight(64);
      button.setOnClickListener(view -> { if (alarmId != null) KampusAlarmService.command(this, command, alarmId); finish(); });
      LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
      size.setMargins(0,10,0,10); layout.addView(button,size);
    }
    setContentView(layout);
  }
  @Override protected void onResume() { super.onResume(); handler.post(refresh); }
  @Override protected void onPause() { handler.removeCallbacksAndMessages(null); super.onPause(); }
  @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); }
}
