export const runtime='nodejs';
export const dynamic='force-dynamic';

// Read-only diagnostic on a Vercel-authenticated preview, absent in production.
// Neither an inference request nor any credit/billing/key configuration occurs.
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
    const number=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;};
    const errorType=typeof data.error?.type==='string'&&/^[a-z0-9_]{1,70}$/.test(data.error.type)?data.error.type:undefined;
    return Response.json({configured:true,status:response.status,balance:number(data.balance),totalCredits:number(data.total_credits),totalUsed:number(data.total_used),...(errorType?{errorType}:{})},{headers});
  } catch {return Response.json({configured:true,status:0},{headers});}
}
