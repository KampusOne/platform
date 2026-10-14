import { describe, expect, it } from 'vitest';
import { storeOrderSchema } from '@kampusone/contracts';
import { input } from './input';
import { AppError } from './errors';

const order={vendorProfileId:'11111111-1111-4111-8111-111111111111',fulfilmentMode:'PICKUP',recipientName:'Ada Student',recipientPhoneE164:'08031234567',items:[{productId:'22222222-2222-4222-8222-222222222222',quantity:1}]};
const labels={recipientName:'Recipient name',recipientPhoneE164:'Recipient phone'};
const context=(value:unknown)=>({req:{json:async()=>value}});
describe('checkout validation response',()=>{
  it('accepts a Nigerian local number and returns its canonical snapshot value',async()=>{
    expect((await input(context(order),storeOrderSchema,labels)).recipientPhoneE164).toBe('+2348031234567');
  });
  it('names invalid fields in the message and returns their inline error details',async()=>{
    try{await input(context({...order,recipientName:'',recipientPhoneE164:'0803'}),storeOrderSchema,labels);throw Error('Validation should fail');}
    catch(error){expect(error).toBeInstanceOf(AppError);const failure=error as AppError;expect(failure.message).toContain('Recipient name:');expect(failure.message).toContain('Recipient phone:');expect(failure.message).not.toContain('highlighted');expect(failure.details?.fields).toMatchObject({recipientName:expect.any(Array),recipientPhoneE164:expect.any(Array)});}
  });
  it('does not promise highlighted fields in a generic validation failure',async()=>{
    await expect(input(context(null),storeOrderSchema)).rejects.toMatchObject({message:'Some information is missing or invalid. Review your entries and try again.'});
  });
});
