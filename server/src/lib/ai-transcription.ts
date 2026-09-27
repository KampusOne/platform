import { AIProviderError, type AIEnvironment } from "./ai-provider";
export const MAX_VOICE_BYTES=6*1024*1024;
const MIME_TYPES=new Set(["audio/mp4","audio/m4a","audio/x-m4a","audio/mpeg","audio/wav","audio/webm","video/webm","audio/ogg"]);
export function validateVoice(file: File): void {
  if(!file.size || file.size>MAX_VOICE_BYTES)throw new AIProviderError(422,"AI_VOICE_TOO_LARGE","Use a voice message smaller than 6 MB.");
  if(!MIME_TYPES.has(file.type.split(';')[0]??''))throw new AIProviderError(400,"AI_VOICE_FORMAT","Record a new voice message in the app.");
}
export async function transcribeVoice(env:AIEnvironment,file:File,fetcher:typeof fetch=fetch):Promise<string>{
  if(env.AI_ASSISTANT_ENABLED!=="true")throw new AIProviderError(503,"AI_DISABLED","Kira is temporarily paused.");
  if(!env.GROQ_API_KEY?.trim()||!env.GROQ_TRANSCRIPTION_MODEL?.trim())throw new AIProviderError(503,"AI_VOICE_UNAVAILABLE","Voice transcription is not available yet. You can still type your question.");
  validateVoice(file);
  const form=new FormData();form.set('file',file,file.name);form.set('model',env.GROQ_TRANSCRIPTION_MODEL);form.set('response_format','json');form.set('temperature','0');
  try{
    const response=await fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`},body:form,signal:AbortSignal.timeout(30000)});
    if(!response.ok){void response.body?.cancel();throw new AIProviderError(503,response.status===429?'AI_PROVIDER_LIMIT':'AI_VOICE_UNAVAILABLE','Voice transcription could not finish. Your recording is kept; try again.');}
    const result=await response.json() as {text?:unknown};
    if(typeof result.text!=='string'||!result.text.trim())throw new AIProviderError(422,'AI_VOICE_EMPTY','No speech was detected. Record again in a quieter place.');
    if(result.text.length>20000)throw new AIProviderError(422,'AI_VOICE_TOO_LONG','Record a shorter voice message.');
    return result.text.trim();
  }catch(error){if(error instanceof AIProviderError)throw error;throw new AIProviderError(503,'AI_VOICE_UNAVAILABLE','Voice transcription could not finish. Your recording is kept; try again.');}
}
