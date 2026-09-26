import {describe,it,expect,vi} from 'vitest';
import {transcribeVoice,validateVoice,MAX_VOICE_BYTES} from '../src/lib/ai-transcription';
const env={AI_ASSISTANT_ENABLED:'true',GROQ_API_KEY:'SYNTHETIC_GROQ',GROQ_TRANSCRIPTION_MODEL:'whisper-large-v3-turbo'};
describe('private voice transcription adapter',()=>{
 it('returns editable transcription and sends only the supplied audio',async()=>{const file=new File(['synthetic audio'],'question.m4a',{type:'audio/mp4'});const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({text:' Explain fluid mechanics. '}));expect(await transcribeVoice(env,file,fetcher)).toBe('Explain fluid mechanics.');expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');expect(fetcher.mock.calls[0]?.[1]?.signal).toBeDefined();});
 it('requires the kill switch and configured server credentials',async()=>{const file=new File(['audio'],'question.m4a',{type:'audio/mp4'}),fetcher=vi.fn<typeof fetch>();await expect(transcribeVoice({...env,AI_ASSISTANT_ENABLED:'false'},file,fetcher)).rejects.toMatchObject({reason:'AI_DISABLED'});await expect(transcribeVoice({...env,GROQ_API_KEY:''},file,fetcher)).rejects.toMatchObject({reason:'AI_VOICE_UNAVAILABLE'});expect(fetcher).not.toHaveBeenCalled();});
 it('rejects oversized and non-audio uploads before provider I/O',()=>{expect(()=>validateVoice(new File([new Uint8Array(MAX_VOICE_BYTES+1)],'voice.m4a',{type:'audio/mp4'}))).toThrow();expect(()=>validateVoice(new File(['data'],'file.pdf',{type:'application/pdf'}))).toThrow();});
});
