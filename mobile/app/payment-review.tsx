import {useCallback,useState} from "react";
import {Linking,Text} from "react-native";
import {router,useFocusEffect,useLocalSearchParams} from "expo-router";
import {ToolPage,ToolButton} from "@/src/components/toolkit";
import {api} from "@/src/lib/api";
import {useAppearance} from "@/src/lib/appearance";
type Summary={id:string;title:string;status:string;base_kobo:number;buyer_fee_kobo:number;delivery_fee_kobo:number;amount_kobo:number;fee_snapshot?:{delivery?:{distanceMetres:number|null;distanceBasis:string}}};
export default function PaymentReview(){
  const {id,type}=useLocalSearchParams<{id:string;type:string}>(),{theme}=useAppearance();
  const [p,setPurchase]=useState<Summary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{try{const r=await api<{purchase:Summary}>(`/v1/payments/summary/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);setPurchase(r.purchase);setError('');}catch(e){setError(e instanceof Error?e.message:'Purchase unavailable.');}},[id,type]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  async function pay(){setBusy(true);setError('');try{const r=await api<{authorizationUrl:string}>('/v1/payments/initialize',{method:'POST',body:JSON.stringify({resourceType:type,resourceId:id,idempotencyKey:`review-${id}-${Date.now()}`})});await Linking.openURL(r.authorizationUrl);}catch(e){setError(e instanceof Error?e.message:'Payment could not open.');}finally{setBusy(false);}}
  const money=(v:number)=>`₦${(Number(v)/100).toLocaleString('en-NG',{minimumFractionDigits:2})}`;
  return <ToolPage title="Review payment">
    {error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton secondary label="Try again" onPress={()=>void load()}/></>:null}
    {p?<><Text style={{fontSize:21,color:theme.text,fontFamily:theme.font.bold}}>{p.title}</Text><Text style={{color:theme.text}}>Items: {money(p.base_kobo)}</Text><Text style={{color:theme.text}}>Delivery: {money(p.delivery_fee_kobo)}</Text>{p.fee_snapshot?.delivery?<Text style={{color:theme.textMuted}}>{p.fee_snapshot.delivery.distanceMetres!=null?`Map distance estimate: ${(p.fee_snapshot.delivery.distanceMetres/1000).toFixed(2)} km`:'Delivery uses the configured campus zone fee.'}</Text>:null}<Text style={{color:theme.text}}>Service fee: {money(p.buyer_fee_kobo)}</Text><Text style={{color:theme.text,fontFamily:theme.font.bold}}>Total: {money(p.amount_kobo)}</Text><Text style={{color:theme.text}}>Status: {p.status.replaceAll('_',' ')}</Text>
      {p.status==='PENDING_PAYMENT'?<ToolButton disabled={busy} label={busy?'Opening checkout…':`Pay ${money(p.amount_kobo)}`} onPress={()=>void pay()}/>:null}</>:!error?<Text style={{color:theme.text}}>Loading your fee breakdown…</Text>:null}
    <ToolButton secondary label="My purchases" onPress={()=>router.push('/(tabs)/purchases')}/>
  </ToolPage>;
}
