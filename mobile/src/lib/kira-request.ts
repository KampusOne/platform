type RequestFailure = { code?:unknown; details?:{reason?:unknown} };
function recoverable(error:unknown) {
  if(!error||typeof error!=="object")return false;
  const failure=error as RequestFailure;
  return ["NETWORK_UNAVAILABLE","REQUEST_TIMEOUT"].includes(String(failure.code))||["AI_PROCESSING","AI_SAVE_FAILED"].includes(String(failure.details?.reason));
}
/** Recover a lost acknowledgement by reading the same reservation, never POSTing twice. */
export async function requestKiraResult<T>({submit,check,isCurrent,onRecovering,wait=milliseconds=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)),now=Date.now,recoveryMs=60000}:{submit:()=>Promise<T>;check:()=>Promise<T&{status?:string}>;isCurrent:()=>boolean;onRecovering?:()=>void;wait?:(milliseconds:number)=>Promise<void>;now?:()=>number;recoveryMs?:number}):Promise<T> {
  let original:unknown;
  try { return await submit(); }
  catch(error) { if(!recoverable(error))throw error; original=error; }
  onRecovering?.();
  const deadline=now()+recoveryMs;
  let connectionFailures=0;
  while(isCurrent()&&now()<deadline) {
    await wait(1500);
    if(!isCurrent())break;
    try {
      const result=await check();
      connectionFailures=0;
      if(result.status!=="processing")return result;
    } catch(error) {
      // Definite provider/file/quota failures remain visible. A missing status
      // route on an older Worker also leaves the original draft intact.
      if(!recoverable(error))throw error;
      if(++connectionFailures>=3)throw error;
    }
  }
  throw original;
}
