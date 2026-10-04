import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedActivityDate,calendarDate,selectedDateLabel,selectedTimeLabel} from '../mobile/src/lib/campus-activity-date.ts';
import {normalizeGroupDetail,normalizeGroupPosts,normalizeGroupComments,normalizeGroupMembers} from '../mobile/src/lib/student-group-state.ts';
test('selected date and 12-hour clock produce a valid local event instant',()=>{
 const event=selectedActivityDate('2027-07-03','10:00');assert.ok(event);assert.equal(event.getFullYear(),2027);assert.equal(event.getMonth(),6);assert.equal(event.getDate(),3);assert.equal(event.getHours(),10);assert.equal(calendarDate(event),'2027-07-03');assert.equal(selectedTimeLabel('10:00'),'10:00 AM');assert.equal(selectedTimeLabel('00:00'),'12:00 AM');assert.equal(selectedTimeLabel('12:00'),'12:00 PM');assert.equal(selectedTimeLabel('22:45'),'10:45 PM');
});
test('calendar handles leap days and rejects rollover rather than silently publishing another date',()=>{
 assert.ok(selectedActivityDate('2028-02-29','09:15'));assert.equal(selectedActivityDate('2027-02-29','09:15'),null);assert.equal(selectedActivityDate('2027-04-31','09:15'),null);assert.equal(selectedActivityDate('2027-07-03','24:00'),null);assert.equal(selectedActivityDate('2027-07-03','10am'),null);assert.equal(selectedActivityDate('12122026','10:00'),null);assert.equal(selectedDateLabel('broken'),'Choose a date');assert.equal(selectedTimeLabel('invalid'),'Choose a time');assert.ok(selectedActivityDate('2027-07-03'));
});
test('malformed group payloads keep profiles and feeds renderable',()=>{
 assert.equal(normalizeGroupDetail(null,'fallback').group.id,'fallback');assert.equal(normalizeGroupDetail({group:{name:12,members:Infinity}},'id').group.members,0);assert.deepEqual(normalizeGroupPosts({posts:{}}),[]);assert.deepEqual(normalizeGroupComments({comments:[null,{id:2}]}),[]);assert.deepEqual(normalizeGroupMembers({members:'bad'}),[]);
 const posts=normalizeGroupPosts({posts:[null,{id:'post',poll_options:[null,'Today'],votes:[null,{index:0,count:'3'}],display_name:null}]});assert.equal(posts[0].display_name,'Student');assert.deepEqual(posts[0].poll_options,['Today']);assert.deepEqual(posts[0].votes,[{index:0,count:3}]);
});
