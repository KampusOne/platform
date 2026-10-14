import {beforeEach,expect,it,vi} from 'vitest';
import {generateAI} from '../src/lib/ai-provider';
import {verifyKiraRecovery} from '../scripts/verify-kira-recovery';
vi.mock('../src/lib/ai-provider',()=>({generateAI:vi.fn()}));
beforeEach(()=>vi.mocked(generateAI).mockReset());
it.each([['3','generation_succeeded'],['4','generation_unusable']])('checks the actual Pro current %s even when the answer uses LaTeX units',async(value,outcome)=>{
  vi.mocked(generateAI).mockImplementation(async(_env,input)=>({provider:'groq',text:input.sourceDocument?'The outgoing current is 5 amperes.':input.tier==='pro'?`I = \\frac{18}{6} = ${value}\\ \\text{A}.`:'The current is 2 amperes.'}));
  const results=await verifyKiraRecovery({});
  expect(results.map(result=>result.outcome)).toEqual(['generation_succeeded',outcome,'generation_succeeded']);
  expect(vi.mocked(generateAI).mock.calls[1]![1].history).toEqual([{prompt:'I have a 6-ohm resistor supplied with 12 volts.',text:'The current in that circuit is 2 amperes.'}]);
});
