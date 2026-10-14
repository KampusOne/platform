import {afterEach,describe,expect,it,vi} from 'vitest';
import {aiResultStream} from './ai-result-stream';
import {AppError} from './errors';

afterEach(()=>vi.useRealTimers());
describe('active AI inference response',()=>{
  it('sends bytes immediately and during a slow read, then yields one valid JSON result',async()=>{
    vi.useFakeTimers();
    let finish!:(value:unknown)=>void;
    const job=new Promise(resolve=>{finish=resolve;});
    const reader=aiResultStream(job,'request-one').getReader();
    const first=await reader.read();expect(new TextDecoder().decode(first.value).trim()).toBe('');
    expect(first.value!.length).toBeGreaterThan(1024);
    await vi.advanceTimersByTimeAsync(65000);
    finish({requestId:'request-one',entries:[{courseCode:'MAT101'}]});
    let text=new TextDecoder().decode(first.value);
    for(;;){const next=await reader.read();if(next.done)break;text+=new TextDecoder().decode(next.value);}
    expect(JSON.parse(text)).toEqual({requestId:'request-one',entries:[{courseCode:'MAT101'}]});
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the classified failure and retry policy when headers have already been sent',async()=>{
    const error=new AppError(422,'BAD_REQUEST','The selected level is missing.',{reason:'AI_LEVEL_NOT_FOUND',retryWithNewKey:true});
    const result=await new Response(aiResultStream(Promise.reject(error),'request-two')).json();
    expect(result).toEqual({requestId:'request-two',status:'failed',httpStatus:422,error:{code:error.code,message:error.message,details:error.details}});
  });
  it('stops heartbeat timers on cancellation without changing the running job or its receipt',async()=>{
    vi.useFakeTimers();let finish!:(value:unknown)=>void;
    const job=new Promise(resolve=>{finish=resolve;});
    const reader=aiResultStream(job,'request-three').getReader();
    await reader.read();await reader.cancel();expect(vi.getTimerCount()).toBe(0);
    finish({requestId:'request-three'});expect(await job).toEqual({requestId:'request-three'});
  });
});
