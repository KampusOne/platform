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
  Bitmap watermark(int width) throws Exception {
    int w=Math.max(100,Math.min(380,width)),h=Math.max(32,w/5);
    Bitmap bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(Color.argb(175,41,35,31));canvas.drawRoundRect(0,0,w,h,h/4f,h/4f,paint);
    Bitmap logo;try(InputStream input=getReactApplicationContext().getAssets().open("kampus-download-mark.png")){logo=BitmapFactory.decodeStream(input);}
    if(logo!=null){canvas.drawBitmap(logo,null,new RectF(h*0.15f,h*0.12f,h*1.12f,h*0.88f),null);logo.recycle();}
    paint.setColor(Color.WHITE);paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));paint.setTextSize(h*0.44f);
    canvas.drawText("KampusOne",h*1.22f,h*0.66f,paint);return bitmap;
  }
  File stampPhoto(File input,File output) throws Exception {
    BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(input.getPath(),bounds);
    if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IOException("Unsupported image.");
    BitmapFactory.Options options=new BitmapFactory.Options();options.inMutable=true;
    // Bound memory while retaining enough resolution for a device download.
    options.inSampleSize=1;while((long)(bounds.outWidth/options.inSampleSize)*(bounds.outHeight/options.inSampleSize)>16000000L)options.inSampleSize*=2;
    Bitmap original=BitmapFactory.decodeFile(input.getPath(),options);if(original==null)throw new IOException("Could not decode image.");
    Bitmap result=original.copy(Bitmap.Config.ARGB_8888,true);original.recycle();
    Bitmap mark=watermark(Math.min(result.getWidth()-12,Math.max(120,result.getWidth()/3)));
    new Canvas(result).drawBitmap(mark,Math.max(0,result.getWidth()-mark.getWidth()-12),Math.max(0,result.getHeight()-mark.getHeight()-12),null);mark.recycle();
    try(OutputStream stream=new FileOutputStream(output)){if(!result.compress(Bitmap.CompressFormat.JPEG,92,stream))throw new IOException("Could not save image.");}finally{result.recycle();}return output;
  }
  File stampVideo(String id,File input,File output,File markFile) throws Exception {
    MediaMetadataRetriever metadata=new MediaMetadataRetriever();long duration;int width;
    try{metadata.setDataSource(input.getPath());duration=Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));width=Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));}finally{metadata.release();}
    Bitmap mark=watermark(Math.max(120,width/3));try(OutputStream stream=new FileOutputStream(markFile)){mark.compress(Bitmap.CompressFormat.PNG,100,stream);}finally{mark.recycle();}
    for(String encoder:new String[]{"h264_mediacodec","mpeg4"}) {
      output.delete();CountDownLatch done=new CountDownLatch(1);final boolean[] success={false};
      String[] arguments={"-y","-i",input.getPath(),"-i",markFile.getPath(),"-filter_complex","[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];[base][1:v]overlay=W-w-12:H-h-12[v]","-map","[v]","-map","0:a?","-c:v",encoder,"-b:v","2500k","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",output.getPath()};
      FFmpegSession session=FFmpegKit.executeWithArgumentsAsync(arguments,finished->{success[0]=ReturnCode.isSuccess(finished.getReturnCode());done.countDown();},log->{},stats->progress(id,"Watermarking",0.65+0.3*Math.min(1,stats.getTime()/Math.max(1d,duration))));
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
  @ReactMethod public void download(String rawUrl,boolean video,String id,Promise promise) {
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
        progress(id,"Watermarking",0.65);
        File output=new File(directory,video?"download.mp4":"download.jpg");
        if(video)stampVideo(id,input,output,new File(directory,"watermark.png"));else stampPhoto(input,output);
        progress(id,"Saving",0.97);Uri saved=saveGallery(output,video);progress(id,"Saved",1);promise.resolve(saved.toString());
      }catch(Exception e){promise.reject("DOWNLOAD_FAILED",e.getMessage()==null?"Could not save this media.":e.getMessage(),e);}
      finally{if(connection!=null)connection.disconnect();File[] files=directory.listFiles();if(files!=null)for(File file:files)file.delete();directory.delete();running.remove(id);}
    });
  }
}
