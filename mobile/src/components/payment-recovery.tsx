import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router,usePathname } from 'expo-router';
import { useAuth } from '../auth/auth-context';
import { pendingPayment } from '../lib/hosted-payment';
import { getDeviceCacheRevision } from '../lib/device-cache';

export function PaymentRecovery() {
  const {user,state}=useAuth(),path=usePathname();
  useEffect(()=>{
    if(state!=='authenticated'||!user||path==='/checkout'||path==='/payment-return'||path==='/payment/return')return;
    let alive=true;const revision=getDeviceCacheRevision();
    const recover=async()=>{
      if(AppState.currentState!=='active')return;
      const saved=await pendingPayment(user.id);
      if(alive&&revision===getDeviceCacheRevision()&&saved)router.replace({pathname:'/payment-return',params:{reference:saved.reference}});
    };
    void recover().catch(()=>undefined);
    const listener=AppState.addEventListener('change',value=>{if(value==='active')void recover().catch(()=>undefined);});
    return()=>{alive=false;listener.remove();};
  },[user,state,path]);
  return null;
}
