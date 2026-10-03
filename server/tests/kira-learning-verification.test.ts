import { describe, expect, it, vi } from "vitest";
import { findLearningVideo, isAvailableLearningVideo, learningRelevance, learningSearchQuery, shouldSuggestLearningVideo, verifiedLearningLinks } from "../src/lib/youtube-learning";
import { aiCompletionBudget, aiSystemInstruction, providerConfiguration } from "../src/lib/ai-provider";
import type { AuthenticatedUser, Bindings } from "../src/types";
vi.mock("../src/lib/database",()=>({database:()=>({execute:async()=>({rows:[{allowed:true}]})}),firstRow:(value:{rows:unknown[]})=>value.rows[0]}));
const env={KIRA_YOUTUBE_ENABLED:"true",YOUTUBE_API_KEY:"test-only"} as Bindings;
const user={id:"20000000-0000-4000-8000-000000000001",email:"test@example.invalid",roles:["STUDENT"],operatorRoles:[],universityId:null} as AuthenticatedUser;
const input={mode:"study" as const,prompt:"Send me a YouTube video on osmosis"};
const available={id:"abcdefghijk",status:{privacyStatus:"public",uploadStatus:"processed",embeddable:true},contentDetails:{}};
describe("Kira lessons and current video recommendations",()=>{
 it("requires topic relevance before preferred-channel ranking",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({items:[{id:{videoId:"wronglink01"},snippet:{title:"Algebra lesson",channelTitle:"Osmosis",description:"Solve linear equations"}},{id:{videoId:"abcdefghijk"},snippet:{title:"Osmosis and cell membranes",channelTitle:"Biology lesson",description:"How water crosses membranes"}}]})).mockResolvedValueOnce(Response.json({items:[available]}));
  const video=await findLearningVideo(env,user,input,fetcher);
  expect(video).toMatchObject({id:"abcdefghijk",verified:true});
  expect(fetcher).toHaveBeenCalledTimes(2);expect(String(fetcher.mock.calls[1][0])).toContain('/videos?');
  expect(String(fetcher.mock.calls[1][0])).not.toContain('wronglink01');
 });
 it.each([{...available,status:{...available.status,privacyStatus:'private'}},{...available,status:{...available.status,uploadStatus:'failed'}},{...available,status:{...available.status,embeddable:false}},{...available,contentDetails:{regionRestriction:{blocked:['NG']}}},{...available,contentDetails:{regionRestriction:{allowed:['US']}}},{...available,contentDetails:{contentRating:{ytRating:'ytAgeRestricted'}}}])("rejects inaccessible video metadata",video=>expect(isAvailableLearningVideo(video)).toBe(false));
 it("uses an honest search link when availability fails",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({items:[{id:{videoId:"abcdefghijk"},snippet:{title:"Osmosis",channelTitle:"Biology"}}]})).mockResolvedValueOnce(Response.json({items:[]}));
  const video=await findLearningVideo(env,user,input,fetcher);expect(video?.verified).toBe(false);expect(video?.url).toContain('/results?search_query=osmosis');expect(video?.url).not.toContain('/watch');
 });
 it("never invents a watch URL when credentials or provider capacity are unavailable",async()=>{
  const noKey=await findLearningVideo({...env,YOUTUBE_API_KEY:undefined},user,input);
  expect(noKey?.url).toContain('/results?');
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:429}));
  expect((await findLearningVideo(env,user,input,fetcher))?.verified).toBe(false);
  expect(await findLearningVideo({...env,KIRA_YOUTUBE_ENABLED:'false'},user,input,fetcher)).toBeUndefined();
 });
 it("retains explicit requests and uses the topic of a short follow-up",()=>{
  expect(shouldSuggestLearningVideo({...input,prompt:'What is osmosis? Send me a video.'})).toBe(true);
  expect(learningSearchQuery({...input,prompt:'Send me a video',history:[{prompt:'Explain osmosis',text:'Water moves across a membrane.'}]})).toBe('osmosis');
  expect(learningRelevance('osmosis','Algebra basics','equations')).toBe(0);
 });
 it("strips provider-invented video links while retaining only the verified link",()=>{
  const video={id:'abcdefghijk',title:'Osmosis',channel:'Biology',description:'',url:'https://www.youtube.com/watch?v=abcdefghijk',verified:true};
  const text=verifiedLearningLinks('Try https://youtu.be/unknown1234 and '+video.url,video);
  expect(text).not.toContain('unknown1234');expect(text).toContain(video.url);
 });
 it("gives teaching explanations a larger bounded output budget and a full lesson structure",()=>{
  expect(aiCompletionBudget({mode:'explanation',tier:'pro'}).maxTokens).toBeGreaterThan(aiCompletionBudget({mode:'study',tier:'standard'}).maxTokens);
  expect(aiSystemInstruction('explanation')).toContain('fully worked example');expect(aiSystemInstruction('explanation')).toContain('practice questions');
  expect(providerConfiguration({HF_TOKEN:'test',HF_CHAT_MODEL:'basic',HF_REASONING_MODEL:'reasoning'},'summary',undefined,undefined,'pro').model).toBe('reasoning');
  for (const mode of ['study','explanation','summary'] as const) {
    expect(providerConfiguration({HF_TOKEN:'test',HF_CHAT_MODEL:'basic',HF_REASONING_MODEL:'reasoning'},mode,undefined,undefined,'standard').model).toBe('basic');
    expect(providerConfiguration({HF_TOKEN:'test',HF_CHAT_MODEL:'basic',HF_REASONING_MODEL:'reasoning'},mode,undefined,undefined,'pro').model).toBe('reasoning');
  }
 });
});
