import test from "node:test";
import assert from "node:assert/strict";
import {alarmFollowupKind,campusDateKey,validExamId} from "../src/lib/alarm-followup.ts";

const examId = "fa233f80-82d4-4fe1-b952-d8943fef68f8";
test("a class reminder never enters exam awareness, even with a stray exam parameter", () => {
  assert.equal(alarmFollowupKind({timetableEntryId:"class-123",examId}),"CLASS");
  assert.equal(alarmFollowupKind({classStartsAt:"08:00",courseCode:"CPE 203"}),"CLASS");
  assert.equal(alarmFollowupKind({courseCode:"CSC 202",examId:"undefined"}),"CLASS");
});
test("only a real exam identifier enables exam awareness", () => {
  assert.equal(alarmFollowupKind({examId}),"EXAM");
  for (const value of [undefined,null,"null","undefined","", "false"]) {
    assert.equal(validExamId(value),false);
    assert.equal(alarmFollowupKind({examId:value}),"OTHER");
  }
});
test("day boundaries use Lagos time even when a device is elsewhere", () => {
  assert.equal(campusDateKey(Date.parse("2026-10-09T22:59:00Z")),"2026-10-09");
  assert.equal(campusDateKey(Date.parse("2026-10-09T23:00:00Z")),"2026-10-10");
});
