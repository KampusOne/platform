package app.kampusone.alarms;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Locale;

public class KampusAlarmActivity extends Activity {
  private static final int INK=Color.rgb(41,35,31);
  private static final int DEEP=Color.rgb(168,70,46);
  private static final int BRAND=Color.rgb(195,93,56);
  private static final int SAND=Color.rgb(241,223,200);
  private static final int CREAM=Color.rgb(251,247,242);
  private static final int PEACH=Color.rgb(233,177,142);

  final Handler handler=new Handler(Looper.getMainLooper());
  String alarmId;
  int snoozeMinutes=5;
  boolean snoozeInitialized=false;
  TextView headline,course,classTitle,classTime,venue,lecturer,remaining,snoozeLabel;
  LinearLayout details;
  Typeface latoBold,latoBlack,interRegular,interSemibold;

  final Runnable refresh=new Runnable(){
    @Override public void run(){
      try{
        String value=KampusAlarmScheduler.prefs(KampusAlarmActivity.this).getString("active",null);
        if(value==null){finish();return;}
        JSONObject active=new JSONObject(value);
        alarmId=active.getString("id");
        if(!snoozeInitialized){
          snoozeMinutes=Math.max(1,Math.min(30,active.optInt("snooze_minutes",5)));
          snoozeInitialized=true;
          renderSnooze();
        }
        renderAlarm(active);
        long seconds=Math.max(0,(active.optLong("endsAt")-System.currentTimeMillis()+999)/1000);
        remaining.setText(String.format(Locale.getDefault(),"Ringing · %d:%02d left",seconds/60,seconds%60));
        if(seconds==0){finish();return;}
        handler.postDelayed(this,500);
      }catch(Exception e){finish();}
    }
  };

  int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}

  Typeface font(String asset,String fallback,int style){
    try{return Typeface.createFromAsset(getAssets(),asset);}
    catch(Exception ignored){return Typeface.create(fallback,style);}
  }

  GradientDrawable rounded(int color,float radius){
    GradientDrawable shape=new GradientDrawable();
    shape.setColor(color);
    shape.setCornerRadius(dp(radius));
    return shape;
  }

  GradientDrawable bordered(int fill,int stroke,float radius){
    GradientDrawable shape=rounded(fill,radius);
    shape.setStroke(dp(1),stroke);
    return shape;
  }

  TextView text(String value,float size,int color,Typeface face){
    TextView view=new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(color);
    view.setTypeface(face);
    view.setGravity(Gravity.CENTER);
    return view;
  }

  LinearLayout.LayoutParams match(int height){
    return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,height);
  }

  String clean(JSONObject source,String key){
    String value=source.optString(key,"").trim();
    return "null".equalsIgnoreCase(value)?"":value;
  }

  String friendlyTime(String value){
    if(value==null||value.trim().isEmpty())return "";
    try{
      SimpleDateFormat input=new SimpleDateFormat("HH:mm",Locale.US);
      SimpleDateFormat output=new SimpleDateFormat("h:mm a",Locale.getDefault());
      return output.format(input.parse(value.trim()));
    }catch(Exception ignored){return value;}
  }

  void renderAlarm(JSONObject active){
    boolean isClass=!active.isNull("timetable_entry_id")&&!clean(active,"timetable_entry_id").isEmpty();
    String label=clean(active,"label");
    String code=clean(active,"course_code");
    String title=clean(active,"course_title");
    String starts=friendlyTime(clean(active,"class_starts_at"));
    String ends=friendlyTime(clean(active,"class_ends_at"));
    String room=clean(active,"venue");
    String teacher=clean(active,"lecturer");

    if(isClass){
      int lead=Math.max(1,active.optInt("reminder_minutes",15));
      headline.setText("Class in "+lead+" minutes");
      course.setText(code.isEmpty()?label:code);
      if(!title.isEmpty()&&!title.equalsIgnoreCase(code)&&!title.equalsIgnoreCase(label)){
        classTitle.setText(title);
        classTitle.setVisibility(View.VISIBLE);
      }else classTitle.setVisibility(View.GONE);
      if(!starts.isEmpty()){
        classTime.setText(starts);
        classTime.setVisibility(View.VISIBLE);
      }else classTime.setVisibility(View.GONE);
      if(!room.isEmpty()){
        venue.setText("Venue  ·  "+room);
        venue.setVisibility(View.VISIBLE);
      }else venue.setVisibility(View.GONE);
      if(!teacher.isEmpty()){
        lecturer.setText("Lecturer  ·  "+teacher);
        lecturer.setVisibility(View.VISIBLE);
      }else lecturer.setVisibility(View.GONE);
      details.setVisibility((!room.isEmpty()||!teacher.isEmpty())?View.VISIBLE:View.GONE);
    }else{
      headline.setText("Reminder");
      course.setText(label.isEmpty()?"Your reminder":label);
      classTitle.setVisibility(View.GONE);
      classTime.setVisibility(View.GONE);
      venue.setVisibility(View.GONE);
      lecturer.setVisibility(View.GONE);
      details.setVisibility(View.GONE);
    }
  }

  void renderSnooze(){
    if(snoozeLabel!=null)snoozeLabel.setText("Snooze "+snoozeMinutes+" min");
  }

  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().setStatusBarColor(INK);
    getWindow().setNavigationBarColor(INK);
    if(Build.VERSION.SDK_INT>=23)getWindow().getDecorView().setSystemUiVisibility(0);

    latoBold=font("fonts/lato-bold.ttf","sans-serif",Typeface.BOLD);
    latoBlack=font("fonts/lato-black.ttf","sans-serif-black",Typeface.BOLD);
    interRegular=font("fonts/inter-regular.ttf","sans-serif",Typeface.NORMAL);
    interSemibold=font("fonts/inter-semibold.ttf","sans-serif-medium",Typeface.BOLD);

    LinearLayout root=new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(24),dp(22),dp(24),dp(28));
    GradientDrawable background=new GradientDrawable(
      GradientDrawable.Orientation.TL_BR,
      new int[]{INK,Color.rgb(91,45,36),DEEP,BRAND}
    );
    root.setBackground(background);

    TextView brand=text("KampusOne",18,CREAM,latoBold);
    brand.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);
    brand.setLetterSpacing(0.01f);
    root.addView(brand,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(44)));

    LinearLayout hero=new LinearLayout(this);
    hero.setOrientation(LinearLayout.VERTICAL);
    hero.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams heroParams=new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,0,1f);
    heroParams.setMargins(0,dp(4),0,dp(18));

    headline=text("Class in 15 minutes",21,SAND,interSemibold);
    headline.setPadding(0,0,0,dp(13));
    hero.addView(headline,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    course=text("",44,Color.WHITE,latoBlack);
    course.setMaxLines(2);
    course.setLineSpacing(0f,0.94f);
    hero.addView(course,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    classTitle=text("",17,CREAM,interRegular);
    classTitle.setMaxLines(2);
    classTitle.setPadding(dp(12),dp(8),dp(12),0);
    hero.addView(classTitle,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    classTime=text("",50,Color.WHITE,latoBold);
    classTime.setPadding(0,dp(24),0,dp(22));
    classTime.setIncludeFontPadding(false);
    hero.addView(classTime,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    details=new LinearLayout(this);
    details.setOrientation(LinearLayout.VERTICAL);
    details.setPadding(dp(18),dp(14),dp(18),dp(14));
    details.setBackground(bordered(0x1AFFFFFF,0x2EFFFFFF,20));
    LinearLayout.LayoutParams detailsParams=new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,LinearLayout.LayoutParams.WRAP_CONTENT);
    detailsParams.setMargins(0,0,0,dp(8));

    venue=text("",15,CREAM,interSemibold);
    venue.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);
    venue.setPadding(0,dp(2),0,dp(7));
    details.addView(venue,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    lecturer=text("",15,SAND,interRegular);
    lecturer.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);
    lecturer.setPadding(0,dp(2),0,0);
    details.addView(lecturer,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    hero.addView(details,detailsParams);

    remaining=text("",13,PEACH,interSemibold);
    remaining.setPadding(0,dp(10),0,0);
    hero.addView(remaining,match(LinearLayout.LayoutParams.WRAP_CONTENT));

    root.addView(hero,heroParams);

    LinearLayout snoozeRow=new LinearLayout(this);
    snoozeRow.setOrientation(LinearLayout.HORIZONTAL);
    snoozeRow.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams snoozeParams=match(dp(58));
    snoozeParams.setMargins(0,0,0,dp(24));

    TextView minus=text("−",30,Color.WHITE,interRegular);
    minus.setBackground(bordered(0x16FFFFFF,0x38FFFFFF,29));
    minus.setContentDescription("Decrease snooze time");
    minus.setOnClickListener(v->{snoozeMinutes=Math.max(1,snoozeMinutes-1);renderSnooze();});
    snoozeRow.addView(minus,new LinearLayout.LayoutParams(dp(58),dp(58)));

    snoozeLabel=text("Snooze 5 min",17,Color.WHITE,interSemibold);
    snoozeLabel.setBackground(rounded(0x22FFFFFF,22));
    snoozeLabel.setContentDescription("Snooze alarm");
    snoozeLabel.setOnClickListener(v->{if(alarmId!=null){KampusAlarmService.command(this,"snooze",alarmId,snoozeMinutes);finish();}});
    LinearLayout.LayoutParams center=new LinearLayout.LayoutParams(0,dp(58),1f);
    center.setMargins(dp(12),0,dp(12),0);
    snoozeRow.addView(snoozeLabel,center);

    TextView plus=text("+",29,Color.WHITE,interRegular);
    plus.setBackground(bordered(0x16FFFFFF,0x38FFFFFF,29));
    plus.setContentDescription("Increase snooze time");
    plus.setOnClickListener(v->{snoozeMinutes=Math.min(30,snoozeMinutes+1);renderSnooze();});
    snoozeRow.addView(plus,new LinearLayout.LayoutParams(dp(58),dp(58)));
    root.addView(snoozeRow,snoozeParams);

    FrameLayout dismissWrap=new FrameLayout(this);
    LinearLayout.LayoutParams dismissWrapParams=new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(154));
    dismissWrap.setPadding(0,0,0,0);

    TextView dismiss=text("Dismiss",19,Color.WHITE,interSemibold);
    dismiss.setBackground(bordered(0x18000000,PEACH,77));
    dismiss.setContentDescription("Dismiss alarm");
    dismiss.setOnClickListener(v->{if(alarmId!=null)KampusAlarmService.command(this,"dismiss",alarmId);finish();});
    FrameLayout.LayoutParams dismissParams=new FrameLayout.LayoutParams(dp(154),dp(154),Gravity.CENTER);
    dismissWrap.addView(dismiss,dismissParams);
    root.addView(dismissWrap,dismissWrapParams);

    setContentView(root);
    renderSnooze();
  }

  @Override protected void onResume(){super.onResume();handler.post(refresh);}
  @Override protected void onPause(){handler.removeCallbacksAndMessages(null);super.onPause();}
  @Override protected void onNewIntent(android.content.Intent intent){super.onNewIntent(intent);setIntent(intent);}
}
