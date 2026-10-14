export const runtime='nodejs';
export const dynamic='force-dynamic';

// Read-only diagnostic on a Vercel-authenticated preview, absent in production.
// Balance is read-only; the optional vision test uses fixed public text only.
// No credit/billing/key configuration or student-data access occurs.
export async function GET(request:Request) {
  const headers={'Cache-Control':'no-store'};
  if(process.env.VERCEL_ENV!=='preview')return new Response(null,{status:404,headers});
  const token=request.headers.get('x-vercel-oidc-token')??process.env.VERCEL_OIDC_TOKEN;
  if(!token)return Response.json({configured:false},{headers});
  try {
    const response=await fetch('https://ai-gateway.vercel.sh/v1/credits',{
      headers:{Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),
    });
    const data=await response.json().catch(()=>({}));
    if(response.ok&&Number(data.balance)>=.05&&new URL(request.url).searchParams.get('probe')==='vision') {
      const image=await sharp(Buffer.from('<svg width="640" height="220"><rect width="100%" height="100%" fill="white"/><text x="30" y="75" font-size="42" font-family="sans-serif">Monday MAT 101</text><text x="30" y="150" font-size="42" font-family="sans-serif">08:00 to 09:00</text></svg>')).png().toBuffer();
      const started=Date.now();
      const inferred=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(25000),
        body:JSON.stringify({model:'google/gemini-2.5-flash-lite',messages:[{role:'user',content:[{type:'text',text:'Read the visible timetable image. Return only JSON with courseCode, startsAt and endsAt. Use a spaced course code and 24-hour HH:MM times.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64')}}]}],max_tokens:256,temperature:0,response_format:{type:'json_object'},reasoning:{effort:'none'}}),
      });
      const output=await inferred.json().catch(()=>({}));
      const source=String(output.choices?.[0]?.message?.content??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
      let value;try{value=JSON.parse(source);}catch{}
      const errorType=typeof output.error?.type==='string'&&/^[a-z0-9_]{1,70}$/.test(output.error.type)?output.error.type:undefined;
      return Response.json({configured:true,status:inferred.status,generated:inferred.ok&&String(value?.courseCode??'').replace(/\s/g,'')==='MAT101'&&value?.startsAt==='08:00'&&value?.endsAt==='09:00',actual:value??source.slice(0,500),elapsedMs:Date.now()-started,finishReason:output.choices?.[0]?.finish_reason,...(errorType?{errorType}:{})},{headers});
    }
    const number=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;};
    const errorType=typeof data.error?.type==='string'&&/^[a-z0-9_]{1,70}$/.test(data.error.type)?data.error.type:undefined;
    return Response.json({configured:true,status:response.status,balance:number(data.balance),totalCredits:number(data.total_credits),totalUsed:number(data.total_used),...(errorType?{errorType}:{})},{headers});
  } catch {return Response.json({configured:true,status:0},{headers});}
}
import sharp from 'sharp';

