import {describe,it,expect} from 'vitest';
import {containsContactDetails} from './chat-contacts';
describe('agent conversation contact detection',()=>{
 it.each(['08012345678','+234 801 234 5678','0123456789','080-1234-5678','０８０１２３４５６７８','080\u200b12345678','zero eight zero one two three four five six seven eight','https://wa.me/2348012345678'])('detects %s',value=>expect(containsContactDetails(value)).toBe(true));
 it.each(['Two pairs please','₦1,500 delivery','PHY 102','We will meet on 2026-10-19','Quantity: 10','Part one and part two are included'])('allows ordinary item information: %s',value=>expect(containsContactDetails(value)).toBe(false));
});
