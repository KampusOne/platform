import {useCallback,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Pressable,ScrollView,Text,View} from 'react-native';
import * as Network from 'expo-network';
import {Ionicons} from '@expo/vector-icons';
import {router,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ToolButton,ToolPage} from '@/src/components/toolkit';
import {useAppearance} from '@/src/lib/appearance';
import {useAuth} from '@/src/auth/auth-context';
import {api,invalidateApiReads} from '@/src/lib/api';
import {dismissPayment} from '@/src/lib/hosted-payment';
import {paymentContinuation,validPaymentReference} from '@/src/lib/payment-flow';
import {getDeviceCacheRevision} from '@/src/lib/device-cache';

type Payment={provider_reference:string;status:string;resource_type:string;resource_id:string;amount_kobo?:number;title?:string;completed_at?:string|null;order_status?:string|null};
const money=(value:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(value/100);
export default function PaymentReturn() {
  const {reference:raw,trxref}=useLocalSearchParams<{reference?:string;trxref?:string}>();
  const reference=raw??trxref??'',{user,state}=useAuth();
  return <OwnedPaymentReturn key={(user?.id??state)+':'+reference} reference={reference}/>;
}
function OwnedPaymentReturn({reference}:{reference:string}) {
  const {theme}=useAppearance(),{user,state}=useAuth();
  const [payment,setPayment]=useState<Payment|null>(null),[error,setError]=useState(''),[checking,setChecking]=useState(false),[exhausted,setExhausted]=useState(false),[online,setOnline]=useState(true),[cycle,setCycle]=useState(0);
  const continuing=useRef(false);
  useFocusEffect(useCallback(()=>{
    if(!user||!validPaymentReference(reference))return;
    let alive=true,running=false,available=AppState.currentState==='active',connected=true,attempts=0,done=false;
    let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    const revision=getDeviceCacheRevision();
    const clear=()=>{if(timer)clearTimeout(timer);timer=undefined;};
    const check=async()=>{
      if(!alive||running||!available||!connected||done||attempts>=24)return;
      running=true;attempts++;controller=new AbortController();setChecking(true);setError('');
      try {
        const result=await api<{payment:Payment}>('/v1/payments/status/'+encodeURIComponent(reference),{cache:'no-store',signal:controller.signal,timeoutMs:15000});
        if(!alive||controller.signal.aborted||revision!==getDeviceCacheRevision())return;
        if(!result.payment||result.payment.provider_reference!==reference)throw new Error('This receipt could not be read. Your saved payment reference is kept.');
        setPayment(result.payment);
        done=['SUCCEEDED','FAILED','REQUIRES_REVIEW'].includes(result.payment.status);
        if(done)invalidateApiReads(['/v1/student/purchases','/v1/student/orders','/v1/agents','/v1/admin']);
      } catch(caught) {
        if(alive&&!controller.signal.aborted)setError(caught instanceof Error?caught.message:'Payment confirmation is unavailable. Your reference is kept.');
      } finally {
        running=false;
        if(alive){setChecking(false);if(attempts>=24)setExhausted(true);else if(!done&&available&&connected)timer=setTimeout(()=>void check(),3000);}
      }
    };
    const publish=()=>{clear();if(!available||!connected)controller?.abort();else void check();};
    const app=AppState.addEventListener('change',value=>{available=value==='active';publish();});
    const network=(value:Network.NetworkState)=>{if(!alive)return;connected=value.isConnected!==false&&value.isInternetReachable!==false;setOnline(connected);publish();};
    const net=Network.addNetworkStateListener(network);
    void Network.getNetworkStateAsync().then(network).catch(()=>undefined);
    setExhausted(false);void check();
    return()=>{alive=false;clear();controller?.abort();app.remove();net.remove();};
  },[reference,user,cycle]));
  const success=payment?.status==='SUCCEEDED',review=payment?.status==='REQUIRES_REVIEW',failed=payment?.status==='FAILED';
  const heading=success?'Payment successful':review?'Payment received for review':failed?'Payment not completed':'Confirming your payment';
  const body=success?'Your payment is confirmed and your purchase is saved.':review?'Your receipt is recorded. We need to review the order before fulfilment. You can follow its status in Purchases.':failed?'This checkout was not completed. Open your saved purchase to review payment.':!online?'You are offline. Confirmation resumes when you reconnect. Your payment reference is kept.':'Checking your receipt with the payment provider. You can leave this screen and return without paying again.';
  async function leave() {
    if(continuing.current||!user)return;continuing.current=true;
    try {await dismissPayment(user.id,reference);router.replace(success&&payment?paymentContinuation(payment):'/(tabs)/purchases');}
    catch(caught){setError(caught instanceof Error?caught.message:'Your receipt could not be kept. Try again.');}
    finally{continuing.current=false;}
  }
  return <ToolPage title="Payment status"><ScrollView contentContainerStyle={{gap:20,paddingTop:28,paddingBottom:40}}>
    <View accessibilityLiveRegion="polite" style={{alignItems:'center',gap:14,padding:24,borderRadius:24,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.border}}>
      <View style={{width:82,height:82,borderRadius:41,backgroundColor:theme.surfaceSoft,alignItems:'center',justifyContent:'center'}}>
        {success||review||failed?<Ionicons name={success?'checkmark-circle-outline':review?'time-outline':'close-circle-outline'} size={50} color={success?theme.success:failed?theme.error:theme.deepBrand}/>:<ActivityIndicator size="large" color={theme.deepBrand}/>}
      </View>
      <Text style={{fontFamily:theme.font.display,fontSize:27,color:theme.text,textAlign:'center'}}>{heading}</Text>
      {payment?.title?<Text style={{fontFamily:theme.font.semibold,fontSize:16,color:theme.text,textAlign:'center'}}>{payment.title}</Text>:null}
      {success&&payment?.amount_kobo!=null?<Text style={{fontFamily:theme.font.display,fontSize:28,color:theme.deepBrand}}>{money(Number(payment.amount_kobo))}</Text>:null}
      <Text style={{fontFamily:theme.font.body,fontSize:14,lineHeight:22,color:theme.textMuted,textAlign:'center'}}>{body}</Text>
      {validPaymentReference(reference)?<Text selectable style={{fontFamily:theme.font.body,fontSize:11,color:theme.textMuted,textAlign:'center'}}>Reference {reference}</Text>:<Text accessibilityRole="alert" style={{color:theme.error}}>This payment link is incomplete. Open Purchases to check your saved order.</Text>}
    </View>
    {state==='anonymous'?<ToolButton label="Sign in to confirm payment" onPress={()=>router.push('/(auth)/sign-in')}/>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,lineHeight:21}}>{error}</Text>:null}
    {success?<ToolButton label={payment?.resource_type==='STORE_ORDER'?'Continue · Track order':'Continue'} onPress={()=>void leave()}/>:<>
      {user&&validPaymentReference(reference)?<ToolButton label={checking?'Checking receipt…':'Check payment again'} disabled={checking||!online} onPress={()=>setCycle(value=>value+1)}/>:null}
      {exhausted&&!review&&!failed?<Text style={{color:theme.textMuted,fontFamily:theme.font.body}}>Confirmation is taking longer. Check again or follow the saved order in Purchases.</Text>:null}
      <Pressable accessibilityRole="button" onPress={()=>void leave()} style={{minHeight:48,justifyContent:'center',alignItems:'center'}}><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand}}>View my purchases</Text></Pressable>
    </>}
  </ScrollView></ToolPage>;
}
