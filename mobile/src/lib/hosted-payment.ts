import { Linking } from 'react-native';
import { router } from 'expo-router';
import { getDeviceCacheRevision, isDeviceCacheOwner, readOwnedDraft, saveOwnedDraft } from './device-cache';
import { validPaymentReference } from './payment-flow';

export type PendingPayment={reference:string;createdAt:number};
const key=(userId:string)=>'payment-draft.'+userId;
export async function pendingPayment(userId:string) {
  if(!isDeviceCacheOwner(userId))return null;
  const value=await readOwnedDraft<PendingPayment|null>(key(userId));
  return value&&validPaymentReference(value.reference)&&Number.isFinite(value.createdAt)&&value.createdAt>Date.now()-7*86400000?value:null;
}
export async function dismissPayment(userId:string,reference:string) {
  const revision=getDeviceCacheRevision();
  const saved=await pendingPayment(userId);
  if(saved?.reference===reference)await saveOwnedDraft(key(userId),null,revision);
}
/** Keep the owned receipt reference before leaving the app; never store a balance. */
export async function openHostedPayment(userId:string,payment:{reference:string;authorizationUrl:string}) {
  if(!validPaymentReference(payment.reference))throw new Error('Checkout did not return a valid payment reference. Your order is saved.');
  const url=new URL(payment.authorizationUrl);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Checkout did not return a secure payment link.');
  await saveOwnedDraft(key(userId),{reference:payment.reference,createdAt:Date.now()});
  router.replace({pathname:'/payment-return',params:{reference:payment.reference}});
  await Linking.openURL(payment.authorizationUrl);
}
