package app.kampusone.alarms;
import android.content.*;
import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.arthenica.ffmpegkit.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class KampusMediaModule extends ReactContextBaseJavaModule {
  final ExecutorService workers = Executors.newFixedThreadPool(2);
  final Set<String> running = ConcurrentHashMap.newKeySet();
  KampusMediaModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "KampusMedia"; }
  @ReactMethod public void addListener(String event) {}
  @ReactMethod public void removeListeners(double count) {}
  void progress(String id, String stage, double value) {
    if (!getReactApplicationContext().hasActiveReactInstance()) return;
    WritableMap event=Arguments.createMap(); event.putString("id",id); event.putString("stage",stage);event.putDouble("progress",Math.max(0,Math.min(1,value)));
    getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("KampusMediaProgress",event);
  }
  @ReactMethod public void videoSize(String uri, Promise promise) {
    workers.execute(()->{MediaMetadataRetriever reader=new MediaMetadataRetriever();
      try { reader.setDataSource(getReactApplicationContext(),Uri.parse(uri)); int width=Integer.parseInt(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)),height=Integer.parseInt(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));String angle=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);if("90".equals(angle)||"270".equals(angle)){int swap=width;width=height;height=swap;}WritableMap result=Arguments.createMap();result.putInt("width",width);result.putInt("height",height);promise.resolve(result); }
      catch(Exception e){promise.reject("VIDEO_SIZE","Could not read video dimensions.",e);}finally{try{reader.release();}catch(Exception ignored){}}});
  }
  String cleanUsername(String raw) {
    if(raw==null)return "";
    String value=raw.trim().replaceFirst("^@+","");
    value=value.replaceAll("[^A-Za-z0-9._-]","");
    return value.length()>32?value.substring(0,32):value;
  }
  String fitLabel(Paint paint,String value,float maxWidth) {
    if(paint.measureText(value)<=maxWidth)return value;
    String suffix="...";
    while(value.length()>1&&paint.measureText(value+suffix)>maxWidth)value=value.substring(0,value.length()-1);
    return value+suffix;
  }
  Bitmap watermark(int videoWidth,String rawUsername) throws Exception {
    int maxWidth=Math.max(96,videoWidth-24);
    int w=Math.min(maxWidth,Math.max(120,Math.min(340,Math.round(videoWidth*0.28f))));
    int h=Math.max(34,Math.min(72,Math.round(w*0.22f)));
    Bitmap bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(Color.argb(188,255,255,255));canvas.drawRoundRect(0,0,w,h,h/2f,h/2f,paint);
    Bitmap logo;try(InputStream input=getReactApplicationContext().getAssets().open("kampus-download-wordmark.png")){logo=BitmapFactory.decodeStream(input);}
    float pad=Math.max(7f,h*0.18f),cursor=pad;
    if(logo!=null&&logo.getWidth()>0&&logo.getHeight()>0){
      float maxLogoW=w*0.55f,maxLogoH=h*0.5f,scale=Math.min(maxLogoW/logo.getWidth(),maxLogoH/logo.getHeight());
      float logoW=logo.getWidth()*scale,logoH=logo.getHeight()*scale,top=(h-logoH)/2f;
      canvas.drawBitmap(logo,null,new RectF(cursor,top,cursor+logoW,top+logoH),null);cursor+=logoW+pad*0.7f;logo.recycle();
    }
    String username=cleanUsername(rawUsername);
    if(!username.isEmpty()){
      paint.setColor(Color.rgb(41,35,31));paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));paint.setTextSize(Math.max(10f,h*0.29f));
      String label=fitLabel(paint,"@"+username,Math.max(1f,w-cursor-pad));
      Paint.FontMetrics metrics=paint.getFontMetrics();float baseline=(h-(metrics.bottom-metrics.top))/2f-metrics.top;
      canvas.drawText(label,cursor,baseline,paint);
    }
    return bitmap;
  }
  File stampPhoto(File input,File output,String username) throws Exception {
    BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(input.getPath(),bounds);
    if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IOException("Unsupported image.");
    BitmapFactory.Options options=new BitmapFactory.Options();options.inMutable=true;
    // Bound memory while retaining enough resolution for a device download.
    options.inSampleSize=1;while((long)(bounds.outWidth/options.inSampleSize)*(bounds.outHeight/options.inSampleSize)>16000000L)options.inSampleSize*=2;
    Bitmap original=BitmapFactory.decodeFile(input.getPath(),options);if(original==null)throw new IOException("Could not decode image.");
    Bitmap result=original.copy(Bitmap.Config.ARGB_8888,true);original.recycle();
    int padding=Math.max(12,Math.min(32,result.getWidth()/60));
    Bitmap mark=watermark(result.getWidth(),username);
    new Canvas(result).drawBitmap(mark,Math.max(0,result.getWidth()-mark.getWidth()-padding),padding,null);mark.recycle();
    try(OutputStream stream=new FileOutputStream(output)){if(!result.compress(Bitmap.CompressFormat.JPEG,92,stream))throw new IOException("Could not save image.");}finally{result.recycle();}return output;
  }
  File stampVideo(String id,File input,File output,File markFile,String username) throws Exception {
    MediaMetadataRetriever metadata=new MediaMetadataRetriever();long duration;int width;
    try{metadata.setDataSource(input.getPath());duration=Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));width=Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));}finally{metadata.release();}
    int padding=Math.max(12,Math.min(32,width/60));
    Bitmap mark=watermark(width,username);try(OutputStream stream=new FileOutputStream(markFile)){mark.compress(Bitmap.CompressFormat.PNG,100,stream);}finally{mark.recycle();}
    for(String encoder:new String[]{"h264_mediacodec","mpeg4"}) {
      output.delete();CountDownLatch done=new CountDownLatch(1);final boolean[] success={false};
      String[] arguments={"-y","-i",input.getPath(),"-i",markFile.getPath(),"-filter_complex","[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];[base][1:v]overlay=W-w-"+padding+":"+padding+"[v]","-map","[v]","-map","0:a?","-c:v",encoder,"-b:v","2500k","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",output.getPath()};
      FFmpegSession session=FFmpegKit.executeWithArgumentsAsync(arguments,finished->{success[0]=ReturnCode.isSuccess(finished.getReturnCode());done.countDown();},log->{},stats->progress(id,"Downloading",0.65+0.3*Math.min(1,stats.getTime()/Math.max(1d,duration))));
      if(!done.await(180,TimeUnit.SECONDS)){FFmpegKit.cancel(session.getSessionId());throw new IOException("Video processing timed out. Try a shorter clip.");}
      if(success[0]&&output.length()>0)return output;
    }
    throw new IOException("This device could not prepare the video download.");
  }
  Uri saveGallery(File file, boolean video) throws Exception {
    ContentResolver resolver=getReactApplicationContext().getContentResolver();ContentValues values=new ContentValues();
    values.put(MediaStore.MediaColumns.DISPLAY_NAME,"KampusOne-"+System.currentTimeMillis()+(video?".mp4":".jpg"));
    values.put(MediaStore.MediaColumns.MIME_TYPE,video?"video/mp4":"image/jpeg");
    if(Build.VERSION.SDK_INT>=29){values.put(MediaStore.MediaColumns.RELATIVE_PATH,(video?Environment.DIRECTORY_MOVIES:Environment.DIRECTORY_PICTURES)+"/KampusOne");values.put(MediaStore.MediaColumns.IS_PENDING,1);}
    Uri uri=resolver.insert(video?MediaStore.Video.Media.EXTERNAL_CONTENT_URI:MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
    if(uri==null)throw new IOException("Could not create the gallery file.");
    try{try(InputStream input=new FileInputStream(file);OutputStream output=resolver.openOutputStream(uri)){if(output==null)throw new IOException("Could not save file.");byte[] bytes=new byte[32768];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);}
      if(Build.VERSION.SDK_INT>=29){values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);resolver.update(uri,values,null,null);}return uri;
    }catch(Exception e){resolver.delete(uri,null,null);throw e;}
  }
  @ReactMethod public void download(String rawUrl,boolean video,String id,String username,Promise promise) {
    if(running.size()>=2||!running.add(id)){promise.reject("DOWNLOAD_BUSY","Two downloads are already running.");return;}
    workers.execute(()->{
      File directory=new File(getReactApplicationContext().getCacheDir(),"kampus-download-"+UUID.randomUUID());directory.mkdirs();
      HttpURLConnection connection=null;
      try {
        URL url=new URL(rawUrl);if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null)throw new IOException("Use a secure media link.");
        connection=(HttpURLConnection)url.openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);
        if(connection.getResponseCode()!=200)throw new IOException("Media could not download. Reopen the post and try again.");
        String type=connection.getContentType();if(type==null||!type.startsWith(video?"video/":"image/"))throw new IOException("This link is not a supported media file.");
        long expected=connection.getContentLengthLong(),total=0,started=System.currentTimeMillis(),last=0;
        if(expected>80*1024*1024)throw new IOException("This file is too large.");
        File input=new File(directory,"input");
        try(InputStream source=connection.getInputStream();OutputStream target=new FileOutputStream(input)){byte[] bytes=new byte[32768];int count;
          while((count=source.read(bytes))!=-1){total+=count;if(total>80*1024*1024||System.currentTimeMillis()-started>180000)throw new IOException("Download timed out or file is too large.");target.write(bytes,0,count);if(System.currentTimeMillis()-last>250){progress(id,"Downloading",expected>0?0.65*total/expected:0);last=System.currentTimeMillis();}}
        }
        progress(id,"Downloading",0.65);
        File output=new File(directory,video?"download.mp4":"download.jpg");
        if(video)stampVideo(id,input,output,new File(directory,"watermark.png"),username);else stampPhoto(input,output,username);
        progress(id,"Downloading",0.97);Uri saved=saveGallery(output,video);progress(id,"Saved",1);promise.resolve(saved.toString());
      }catch(Exception e){promise.reject("DOWNLOAD_FAILED",e.getMessage()==null?"Could not save this media.":e.getMessage(),e);}
      finally{if(connection!=null)connection.disconnect();File[] files=directory.listFiles();if(files!=null)for(File file:files)file.delete();directory.delete();running.remove(id);}
    });
  }
}
