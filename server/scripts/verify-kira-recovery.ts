import {generateAI,type AIEnvironment,type AIInput} from '../src/lib/ai-provider';

/** Public fixed fixtures; no student messages, writes, subscriptions or credits. */
export async function verifyKiraRecovery(env:AIEnvironment){
  const cases:{name:string;input:AIInput;expected:RegExp}[]=[
    {name:'standard',input:{mode:'study',tier:'standard',prompt:'A 6-ohm resistor is supplied with 12 volts. Calculate the current and state it in amperes.'},expected:/2\s*(?:A\b|amperes?)/i},
    {name:'pro-context',input:{mode:'study',tier:'pro',prompt:'For that same resistor, now supplied with 18 volts, calculate the current and state it in amperes.',history:[{prompt:'I have a 6-ohm resistor supplied with 12 volts.',text:'The current in that circuit is 2 amperes.'}]},expected:/3\s*(?:A\b|amperes?)/i},
    {name:'document-summary',input:{mode:'summary',tier:'pro',sourceDocument:true,prompt:'Summarize this study note faithfully, retaining its calculated current. Quoted study note: Kirchhoff’s current law says the sum of currents entering a junction equals the sum leaving. Two currents of 3 amperes and 2 amperes enter. The sole outgoing current is 5 amperes.'},expected:/5\s*(?:A\b|amperes?)/i},
  ];
  const results=[];
  for(const fixture of cases){
    const began=Date.now();
    try{
      const result=await generateAI({...env,AI_ASSISTANT_ENABLED:'true'},fixture.input);
      results.push({name:fixture.name,outcome:fixture.expected.test(result.text)?'generation_succeeded':'generation_unusable',provider:result.provider,elapsedMs:Date.now()-began});
    }catch(error){
      const reason=(error as {reason?:string}).reason;
      results.push({name:fixture.name,outcome:'provider_rejected',elapsedMs:Date.now()-began,...(reason&&/^AI_[A-Z_]+$/.test(reason)?{reason}:{})});
    }
  }
  return results;
}
