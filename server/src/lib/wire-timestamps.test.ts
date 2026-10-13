import { describe, expect, it } from 'vitest';
import { isoTimestamp } from './wire-timestamps';
describe('portable payment timestamps',()=>{
  it('normalizes actual Neon PostgreSQL text, offsets and Date objects to the ISO form Hermes accepts',()=>{
    for(const value of ['2026-10-13 14:52:47.080544+00','2026-10-13 15:52:47.080544+01',new Date('2026-10-13T14:52:47.080Z')])
      expect(isoTimestamp(value)).toBe('2026-10-13T14:52:47.080Z');
  });
  it('rejects invalid database dates instead of publishing a malformed checkout expiry',()=>{
    expect(()=>isoTimestamp('invalid')).toThrow();
  });
});
