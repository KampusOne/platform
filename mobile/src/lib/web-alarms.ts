import type {Alarm} from "./alarms";
let timer:ReturnType<typeof setInterval>|undefined;
let active:Alarm[]=[];
const fired=new Set<string>();
let sound:AudioContext|undefined;
let customSoundUrl:string|undefined,clip:HTMLAudioElement|undefined;
export function setWebAlarmSound(url?:string){customSoundUrl=url;}
function playTone(){if(sound?.state!=="running")return;const tone=sound.createOscillator(),volume=sound.createGain();tone.connect(volume);volume.connect(sound.destination);tone.frequency.value=660;volume.gain.setValueAtTime(0.08,sound.currentTime);volume.gain.exponentialRampToValueAtTime(0.001,sound.currentTime+1.5);tone.start();tone.stop(sound.currentTime+1.5);}
export function stopWebAlarms(){if(timer)clearInterval(timer);timer=undefined;active=[];fired.clear();clip?.pause();customSoundUrl=undefined;}
function tick(){
  const now=new Date(),lagos=new Date(now.getTime()+3600000),day=lagos.getUTCDay(),clock=lagos.toISOString().slice(11,16),date=lagos.toISOString().slice(0,10);
  for(const alarm of active){
    const time=alarm.fires_at?Date.parse(alarm.fires_at):NaN;
    const due=alarm.days.length?alarm.days.includes(day)&&alarm.time===clock:Number.isFinite(time)&&now.getTime()>=time&&now.getTime()-time<60000;
    const key=`${alarm.id}:${date}:${clock}`;
    if(!alarm.enabled||!due||fired.has(key))continue;
    fired.add(key);if(fired.size>500)fired.delete(fired.values().next().value!);
    window.dispatchEvent(new CustomEvent("k1-alarm",{detail:{label:alarm.label}}));
    if("Notification" in window&&Notification.permission==="granted")try{new Notification(alarm.label,{body:"KampusOne reminder",tag:key,silent:alarm.sound==="silent"});}catch{/* In-app banner remains available. */}
    if(alarm.sound==="default"){
      if(customSoundUrl){clip?.pause();const playing=new Audio(customSoundUrl);clip=playing;void playing.play().catch(playTone);setTimeout(()=>playing.pause(),10000);}else playTone();
    }
    if(alarm.vibration)navigator.vibrate?.([200,100,200]);
  }
}
export async function syncWebAlarms(alarms:Alarm[],requestPermission:boolean){
  if(typeof window==="undefined")return false;
  if(requestPermission){
    if("Notification" in window&&Notification.permission==="default")await Notification.requestPermission();
    try{if("AudioContext" in window){sound??=new AudioContext();await sound.resume();}}catch{/* Sound permission is optional. */}
  }
  active=alarms;timer??=setInterval(tick,15000);tick();return true;
}
