import { useCallback,useRef,useState } from "react";
import { Linking,Text,View } from "react-native";
import { router,useFocusEffect,useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { ToolPage,ToolButton } from "@/src/components/toolkit";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
type Quote={title:string;priceKobo:number;buyerFeeKobo:number;amountKobo:number;packageDays:number|null;fees:{buyer:{version:string};commission:{version:string}}};
export default function LearningCheckout(){
  const {resourceId,listingId}=useLocalSearchParams<{resourceId?:string;listingId?:string}>(),{theme}=useAppearance();
  const [quote,setQuote]=useState<Quote|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[purchase,setPurchase]=useState('');
  const key=useRef(Crypto.randomUUID());
  const load=useCallback(async()=>{try{const r=await api<{quote:Quote}>('/v1/tutor-commerce/quote',{method:'POST',body:JSON.stringify(resourceId?{resourceId}:{listingId})});setQuote(r.quote);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load price.');}},[resourceId,listingId]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  async function buy(){if(!quote||busy)return;setBusy(true);setError('');try{
    const result=await api<{purchase:{id:string;status:string}}>('/v1/tutor-commerce/purchases',{method:'POST',body:JSON.stringify({id:key.current,target:resourceId?{resourceId}:{listingId},quote})});
    setPurchase(result.purchase.id);
    if(result.purchase.status==='PAID'){router.replace('/learning-library');return;}
    const payment=await api<{authorizationUrl:string}>('/v1/payments/initialize',{method:'POST',body:JSON.stringify({resourceType:'TUTORIAL_PURCHASE',resourceId:result.purchase.id,idempotencyKey:`learning-${result.purchase.id}`})});
    await Linking.openURL(payment.authorizationUrl);
  }catch(e){setError(e instanceof Error?e.message:'Checkout could not open. Your purchase is saved for retry.');}finally{setBusy(false);}}
  const money=(v:number)=>`₦${(v/100).toLocaleString('en-NG',{minimumFractionDigits:2})}`;
  return <ToolPage title="Learning checkout">
    {error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton secondary label="Refresh price" disabled={busy} onPress={()=>void load()}/></>:null}
    {!quote&&!error?<Text style={{color:theme.text}}>Loading price…</Text>:null}
    {quote?<View style={{gap:16}}><Text style={{color:theme.text,fontSize:22,fontFamily:theme.font.bold}}>{quote.title}</Text>
      <Text style={{color:theme.text}}>{quote.packageDays?`${quote.packageDays} days of tutor messaging and included materials. Renewals extend the current period.`:'Personal access to the purchased material.'}</Text>
      <Text style={{color:theme.text}}>Product: {money(quote.priceKobo)}</Text><Text style={{color:theme.text}}>Service fee: {money(quote.buyerFeeKobo)}</Text>
      <Text style={{color:theme.text,fontFamily:theme.font.bold}}>Total: {money(quote.amountKobo)}</Text>
      <Text style={{color:theme.textMuted}}>Access starts after payment is confirmed. Report a problem within seven days of the material purchase or package end.</Text>
      <ToolButton label={busy?'Opening secure checkout…':quote.amountKobo?`Pay ${money(quote.amountKobo)}`:'Activate free package'} disabled={busy||Boolean(error)} onPress={()=>void buy()}/>
    </View>:null}
    {purchase?<Text style={{color:theme.text}}>Payment confirmation will appear in your learning purchases. Returning from checkout alone does not activate access.</Text>:null}
    <ToolButton secondary label="My learning purchases" onPress={()=>router.push('/learning-library')}/>
  </ToolPage>;
}
