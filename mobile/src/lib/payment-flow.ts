export {validPaymentReference} from '../../../packages/contracts/src/payment-links';
export function paymentContinuation(payment: {resource_type:string;resource_id:string}) {
  if(payment.resource_type==='STORE_ORDER')return {pathname:'/order-detail' as const,params:{id:payment.resource_id}};
  if(payment.resource_type==='TUTORIAL_PURCHASE')return '/learning-library' as const;
  if(payment.resource_type==='KIRA_SUBSCRIPTION')return '/ai-subscription' as const;
  if(payment.resource_type==='RIDER_COMMISSION')return '/earnings' as const;
  return '/(tabs)/purchases' as const;
}
