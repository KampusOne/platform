import {generateAI,type AIEnvironment,type AIInput} from '../src/lib/ai-provider';
import {readPrivateAIPdf} from '../src/lib/ai-pdf-reader';
import {scannedPdfFixture} from '../tests/helpers/pdf';

/** Public fixed fixtures; no student messages, writes or import-credit changes. */
export async function verifyKiraRecovery(env:AIEnvironment,fixtures?:{image:string;handwriting:{jpegBase64:string;width:number;height:number}}){
  const cases:{name:string;input:AIInput;expected:RegExp}[]=[
    {name:'standard',input:{mode:'study',tier:'standard',prompt:'A 6-ohm resistor is supplied with 12 volts. Calculate the current and state it in amperes.'},expected:/2\s*(?:A\b|amperes?)/i},
    {name:'pro-context',input:{mode:'study',tier:'pro',prompt:'For that same resistor, now supplied with 18 volts, calculate the current and state it in amperes.',history:[{prompt:'I have a 6-ohm resistor supplied with 12 volts.',text:'The current in that circuit is 2 amperes.'}]},expected:/3\s*(?:A\b|amperes?)/i},
    {name:'document-summary',input:{mode:'summary',tier:'pro',sourceDocument:true,prompt:'Summarize this study note faithfully, retaining its calculated current. Quoted study note: Kirchhoff’s current law says the sum of currents entering a junction equals the sum leaving. Two currents of 3 amperes and 2 amperes enter. The sole outgoing current is 5 amperes.'},expected:/5\s*(?:A\b|amperes?)/i},
  ];
  if(fixtures?.image)cases.push({name:'image-question',input:{mode:'study',tier:'pro',sourceDocument:true,prompt:'Read the course code and the starting hour shown in this image.',media:{mimeType:'image/png',data:fixtures.image}},expected:/(?=[\s\S]*MAT\s*101)(?=[\s\S]*\b(?:08:00|8:00|8\s*(?:AM|a\.m\.)))/i});
  const results=[];
  for(const fixture of cases){
    const began=Date.now();
    try{
      const result=await generateAI({...env,AI_ASSISTANT_ENABLED:'true'},fixture.input);
      // Accept the same unit when rendered as ordinary text or LaTeX.
      // The expected number and amperes are still checked together.
      const plain=result.text.replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g,'$1').replace(/\\[,;! ]/g,' ');
      results.push({name:fixture.name,outcome:fixture.expected.test(plain)?'generation_succeeded':'generation_unusable',provider:result.provider,elapsedMs:Date.now()-began});
    }catch(error){
      const reason=(error as {reason?:string}).reason;
      results.push({name:fixture.name,outcome:'provider_rejected',elapsedMs:Date.now()-began,...(reason&&/^AI_[A-Z_]+$/.test(reason)?{reason}:{})});
    }
  }
  if(fixtures?.handwriting){
    const began=Date.now();
    try {
      const image=fixtures.handwriting,jpeg=Uint8Array.from(atob(image.jpegBase64),character=>character.charCodeAt(0));
      const text=await readPrivateAIPdf({...env,AI_ASSISTANT_ENABLED:'true'},scannedPdfFixture(jpeg,image.width,image.height));
      const result=await generateAI({...env,AI_ASSISTANT_ENABLED:'true'},{mode:'summary',tier:'pro',sourceDocument:true,prompt:'Summarize this private scanned study source faithfully: '+text,deadline:began+120000});
      results.push({name:'scanned-pdf-summary',outcome:/MAT\s*101/i.test(text)&&/MAT\s*101/i.test(result.text)?'generation_succeeded':'generation_unusable',provider:result.provider,elapsedMs:Date.now()-began});
    }catch(error){const reason=(error as {reason?:string}).reason;results.push({name:'scanned-pdf-summary',outcome:'provider_rejected',elapsedMs:Date.now()-began,...(reason&&/^AI_[A-Z_]+$/.test(reason)?{reason}:{})});}
  }
  return results;
}
