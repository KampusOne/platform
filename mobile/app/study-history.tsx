import {useCallback,useEffect,useRef,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {router,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {useAuth} from '@/src/auth/auth-context';
import {ToolButton,ToolPage} from '@/src/components/toolkit';
import {ScreenSkeleton} from '@/src/components/skeleton';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
type Insights={active:{id:string;started_at:string}|null;members:{user_id:string;display_name:string;username:string;today_seconds:number;week_seconds:number;month_seconds:number;studying_now:boolean}[];days:{user_id:string;display_name:string;day:string;seconds:number}[]};
const clock=(seconds:number)=>{const whole=Math.max(0,Math.floor(seconds));return `${String(Math.floor(whole/3600)).padStart(2,'0')}:${String(Math.floor(whole%3600/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`;};
const duration=(seconds:number)=>`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
export default function StudyHistory(){
 const {id,name}=useLocalSearchParams<{id?:string;name?:string}>(),{theme}=useAppearance(),{user}=useAuth();const [data,setData]=useState<Insights|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now()),[goal,setGoal]=useState(25),[selected,setSelected]=useState<string|null>(null);const requestId=useRef(randomUUID());
 const base='/v1/communities/groups/'+id+'/study';
 const load=useCallback(async()=>{if(!id)return;setError('');try{setData(await api<Insights>(base));}catch(e){setError(e instanceof Error?e.message:'Could not load study time.');}},[base,id]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 useEffect(()=>{if(!data?.active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[data?.active]);
 const elapsed=data?.active?Math.min(12*3600,Math.max(0,(now-Date.parse(data.active.started_at))/1000)):0;
 async function start(){setBusy(true);setError('');try{await api(base+'/start',{method:'POST',body:JSON.stringify({requestId:requestId.current})});setNow(Date.now());await load();}catch(e){setError(e instanceof Error?e.message:'Could not start your study session.');}finally{setBusy(false);}}
 async function stop(){if(!data?.active)return;setBusy(true);setError('');try{await api(base+'/stop',{method:'POST',body:JSON.stringify({sessionId:data.active.id})});requestId.current=randomUUID();await load();}catch(e){setError(e instanceof Error?e.message:'Could not save your session. Keep this screen open and retry.');}finally{setBusy(false);}}
 const text={fontFamily:theme.font.body,color:theme.text,fontSize:14,lineHeight:23};
 const chosen=selected??user?.id;const days=data?.days.filter(day=>day.user_id===chosen)??[];
 return <ToolPage title={name??'Study time'} onRefresh={()=>void load()}>
 {!id?<><Text style={text}>Open one of your study groups to track a session and see the group’s progress.</Text><ToolButton label="Open study groups" onPress={()=>router.push('/communities')}/><ToolButton secondary label="Kira conversation history" onPress={()=>router.push('/ai?history=1')}/></>:<>
 {error?<View style={{padding:14,borderRadius:12,backgroundColor:theme.surfaceMuted,marginBottom:14}}><Text accessibilityRole="alert" style={[text,{color:theme.error}]}>{error}</Text><ToolButton secondary label="Try again" onPress={()=>void load()}/></View>:null}
 {!data&&!error?<ScreenSkeleton/>:data?<>
 <View style={{padding:24,marginBottom:20,borderRadius:20,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.border,alignItems:'center',gap:14}}>
 <Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:12,letterSpacing:1}}>{data.active?'STUDYING NOW':'YOUR FOCUS TIME'}</Text>
 <Text accessibilityLiveRegion="none" style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:46,fontVariant:['tabular-nums']}}>{clock(data.active?elapsed:0)}</Text>
 <Text style={[text,{color:theme.textMuted,textAlign:'center'}]}>{data.active?elapsed>=goal*60?'Your focus goal is complete. Stop when you finish.':clock(goal*60-elapsed)+' left in your focus goal':'Pick a focus goal, then start studying.'}</Text>
 {!data.active?<View style={{flexDirection:'row',gap:8}}>{[25,50,90].map(minutes=><Pressable key={minutes} accessibilityRole="button" accessibilityState={{selected:goal===minutes}} onPress={()=>setGoal(minutes)} style={{padding:12,borderRadius:12,backgroundColor:goal===minutes?theme.surfaceTint:theme.surfaceMuted,borderWidth:1,borderColor:goal===minutes?theme.deepBrand:theme.border}}><Text style={text}>{minutes} min</Text></Pressable>)}</View>:null}
 <View style={{alignSelf:'stretch'}}><ToolButton disabled={busy} label={busy?'Saving…':data.active?'Stop and save session':'Start studying'} onPress={()=>void(data.active?stop():start())}/></View>
 <Text style={[text,{fontSize:12,color:theme.textMuted,textAlign:'center'}]}>Your time stays active when you leave this screen. Completed sessions are shared only with this study group.</Text>
 </View>
 <Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:21,marginBottom:12}}>Group insights</Text>
 <Text style={[text,{fontSize:12,color:theme.textMuted,marginBottom:14}]}>Times use your campus day. Tap a member to see their study calendar.</Text>
 {data.members.map(member=><Pressable key={member.user_id} accessibilityRole="button" accessibilityState={{selected:chosen===member.user_id}} onPress={()=>setSelected(member.user_id)} style={{padding:16,borderRadius:16,borderWidth:1,borderColor:chosen===member.user_id?theme.deepBrand:theme.border,backgroundColor:chosen===member.user_id?theme.surfaceTint:theme.surface,marginBottom:10,gap:10}}>
 <Text style={[text,{fontFamily:theme.font.semibold}]}>{member.display_name}{member.user_id===user?.id?' · You':''}{member.studying_now?' · Studying now':''}</Text><View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}>{[['Today',member.today_seconds],['This week',member.week_seconds],['This month',member.month_seconds]].map(([label,seconds])=><View key={String(label)}><Text style={[text,{fontSize:11,color:theme.textMuted}]}>{label}</Text><Text style={[text,{fontFamily:theme.font.semibold}]}>{duration(Number(seconds))}</Text></View>)}</View>
 </Pressable>)}
 <Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:20,marginTop:20,marginBottom:12}}>Study calendar</Text>
 {days.length?days.map(day=><View key={day.day} style={{paddingVertical:13,borderBottomWidth:1,borderColor:theme.border,flexDirection:'row',justifyContent:'space-between'}}><Text style={text}>{new Date(day.day+'T12:00:00Z').toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</Text><Text style={[text,{fontFamily:theme.font.semibold}]}>{duration(day.seconds)}</Text></View>):<Text style={[text,{color:theme.textMuted}]}>No completed sessions yet.</Text>}
 </>:null}
 </>}
 </ToolPage>;
}
