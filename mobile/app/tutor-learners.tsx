import {useCallback,useState} from "react";
import {Text,View} from "react-native";
import {router,useFocusEffect} from "expo-router";
import {ToolPage,ToolButton} from "@/src/components/toolkit";
import {useAppearance} from "@/src/lib/appearance";
import {useAuth} from "@/src/auth/auth-context";
import {api} from "@/src/lib/api";
type Learner={id:string;title:string;status:string;student_user_id:string;student_name:string;access_ends_at:string|null;chat_active:boolean;price_kobo:number;commission_kobo:number;tutor_net_kobo:number;earnings_state:string};
export default function TutorLearners(){
  const {theme}=useAppearance(),{user}=useAuth();const [rows,setRows]=useState<Learner[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState('');
  const load=useCallback(async()=>{try{setRows((await api<{learners:Learner[]}>('/v1/tutor-commerce/learners')).learners);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load learners.');}finally{setLoading(false);}},[]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  async function chat(r:Learner){setBusy(r.id);try{const response=await api<{thread:{id:string}}>('/v1/tutor-commerce/threads',{method:'POST',body:JSON.stringify({studentId:r.student_user_id,tutorId:user?.id})});router.push({pathname:'/conversation',params:{id:response.thread.id}});}catch(e){setError(e instanceof Error?e.message:'Chat unavailable.');}finally{setBusy('');}}
  return <ToolPage title="Learners & product sales"><ToolButton secondary label="Refresh" onPress={()=>void load()}/>{error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}{loading?<Text style={{color:theme.text}}>Loading learners…</Text>:!rows.length?<Text style={{color:theme.text}}>Confirmed material and package purchases will appear here.</Text>:null}
    {rows.map(r=><View key={r.id} style={{paddingVertical:18,gap:10,borderBottomWidth:1,borderColor:theme.border}}><Text style={{color:theme.text,fontFamily:theme.font.bold}}>{r.student_name} · {r.title}</Text><Text style={{color:theme.text}}>{r.status} · Earnings {r.earnings_state.toLowerCase()}</Text><Text style={{color:theme.text}}>Sale ₦{r.price_kobo/100} · Commission ₦{r.commission_kobo/100} · Your earnings ₦{r.tutor_net_kobo/100}</Text>{r.access_ends_at?<Text style={{color:theme.text}}>Access ends {new Date(r.access_ends_at).toLocaleString()}</Text>:null}{r.chat_active?<ToolButton label="Message student" disabled={Boolean(busy)} onPress={()=>void chat(r)}/>:null}</View>)}
  </ToolPage>;
}
