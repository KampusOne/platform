import { useCallback,useState } from "react";
import { Linking,Text,View } from "react-native";
import { router,useFocusEffect } from "expo-router";
import { ToolPage,ToolButton,ToolField } from "@/src/components/toolkit";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { useAuth } from "@/src/auth/auth-context";
type Purchase={id:string;title:string;status:string;access_status:string;amount_kobo:number;price_kobo:number;buyer_fee_kobo:number;listing_id:string|null;resource_id:string|null;media_object_id:string|null;can_access_resource:boolean;tutor_user_id:string;tutor_name:string;access_starts_at:string|null;access_ends_at:string|null;release_at:string|null};
export default function LearningLibrary(){
  const {theme}=useAppearance(),{user}=useAuth();
  const [items,setItems]=useState<Purchase[]>([]),[next,setNext]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[dispute,setDispute]=useState(''),[reason,setReason]=useState('');
  const load=useCallback(async(before?:string)=>{try{const r=await api<{purchases:Purchase[];nextCursor:string|null}>('/v1/tutor-commerce/purchases'+(before?'?before='+before:''));setItems(old=>before?[...old,...r.purchases]:r.purchases);setNext(r.nextCursor);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load purchases.');}finally{setLoading(false);}},[]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  async function act(p:Purchase,kind:'pay'|'open'|'chat'|'dispute'){setBusy(p.id);setError('');try{
    if(kind==='pay'){const r=await api<{authorizationUrl:string}>('/v1/payments/initialize',{method:'POST',body:JSON.stringify({resourceType:'TUTORIAL_PURCHASE',resourceId:p.id,idempotencyKey:`learning-${p.id}-${Date.now()}`})});await Linking.openURL(r.authorizationUrl);}
    if(kind==='open'){const r=await api<{url:string}>(`/v1/media/${p.media_object_id}/access`,{method:'POST'});await Linking.openURL(r.url);}
    if(kind==='chat'){const r=await api<{thread:{id:string}}>('/v1/tutor-commerce/threads',{method:'POST',body:JSON.stringify({studentId:user?.id,tutorId:p.tutor_user_id})});router.push({pathname:'/conversation',params:{id:r.thread.id}});}
    if(kind==='dispute'){await api(`/v1/tutor-commerce/purchases/${p.id}/dispute`,{method:'POST',body:JSON.stringify({reason})});setDispute('');setReason('');await load();}
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy('');}}
  return <ToolPage title="My learning purchases"><ToolButton secondary label="Refresh payment and access" disabled={Boolean(busy)} onPress={()=>void load()}/>
    {loading?<Text style={{color:theme.text}}>Loading purchases…</Text>:null}{error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}
    {!loading&&!error&&!items.length?<Text style={{color:theme.text}}>Your materials and tutor packages will appear here.</Text>:null}
    {items.map(p=><View key={p.id} style={{paddingVertical:18,gap:10,borderBottomWidth:1,borderColor:theme.border}}>
      <Text style={{color:theme.text,fontSize:19,fontFamily:theme.font.bold}}>{p.title}</Text><Text style={{color:theme.text}}>{p.tutor_name} · {p.access_status.replaceAll('_',' ')} · ₦{(p.amount_kobo/100).toLocaleString('en-NG')}</Text>
      <Text style={{color:theme.text}}>Product ₦{p.price_kobo/100} · Service fee ₦{p.buyer_fee_kobo/100}</Text>
      {p.access_ends_at?<Text style={{color:theme.text}}>Access: {new Date(p.access_starts_at!).toLocaleString()} – {new Date(p.access_ends_at).toLocaleString()}</Text>:null}
      {p.status==='PENDING_PAYMENT'?<ToolButton disabled={Boolean(busy)} label="Resume secure payment" onPress={()=>void act(p,'pay')}/>:null}
      {p.can_access_resource&&p.media_object_id?<ToolButton disabled={Boolean(busy)} label="Open purchased material" onPress={()=>void act(p,'open')}/>:null}
      {p.listing_id&&p.access_status==='ACTIVE'?<ToolButton disabled={Boolean(busy)} label="Message tutor" onPress={()=>void act(p,'chat')}/>:null}
      {p.listing_id&&['ACTIVE','EXPIRED','UPCOMING'].includes(p.access_status)?<ToolButton secondary label="Renew package" onPress={()=>router.push({pathname:'/learning-checkout',params:{listingId:p.listing_id!}})}/>:null}
      {p.status==='PAID'&&p.release_at&&Date.parse(p.release_at)>Date.now()?<ToolButton secondary label="Report a purchase problem" onPress={()=>{setDispute(p.id);setReason('');}}/>:null}
      {dispute===p.id?<><ToolField label="What went wrong?" value={reason} onChangeText={setReason} multiline maxLength={1000}/><Text style={{color:theme.textMuted}}>Submitting pauses access and tutor earnings while support reviews the purchase.</Text><ToolButton label="Submit for review" disabled={Boolean(busy)||reason.trim().length<10} onPress={()=>void act(p,'dispute')}/></>:null}
    </View>)}{next?<ToolButton secondary label="Load earlier purchases" onPress={()=>void load(next)}/>:null}
  </ToolPage>;
}
