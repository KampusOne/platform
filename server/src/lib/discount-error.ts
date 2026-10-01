import {AppError} from './errors';
export function discountError(error:unknown):never{
 if(error instanceof Error&&/DISCOUNT_/.test(error.message))throw new AppError(422,'BAD_REQUEST',error.message.includes('INAPPLICABLE')?'This code does not apply to this purchase. Delivery codes require an in-app rider fare.':error.message.includes('REQUEST_CONFLICT')?'Your discount changed. Review a new checkout before paying.':'This code has expired, reached its use limit, or exhausted its campaign budget.');
 throw error;
}
