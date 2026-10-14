import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerDates, serverDate } from '../mobile/src/lib/server-date.ts';
test('Postgres microseconds and UTC offsets become strict timestamps accepted by Android dates',()=>{
  for(const raw of ['2026-10-13 23:21:04.928123+00','2026-10-13T23:21:04.928123+0000']){
    const value=normalizeServerDates({created_at:raw,events:[{expiresAt:raw}]});
    assert.match(value.created_at,/^2026-10-13T23:21:04\.928\+00:00$/);
    assert.equal(new Date(value.created_at).toISOString(),'2026-10-13T23:21:04.928Z');
    assert.equal(value.events[0].expiresAt,value.created_at);
  }
});
test('date normalization preserves timetable clocks, calendar dates and literal student content',()=>{
  const value={startsAt:'08:00',date:'2026-10-14',prompt:'2026-10-13 23:21:04.928123+00',account_name:'GIDEON',notes:'My notes'};
  assert.deepEqual(normalizeServerDates(value),value);
  for(const invalid of [undefined,null,'',{},NaN,Infinity,'not a date'])assert.equal(serverDate(invalid),null);
});
