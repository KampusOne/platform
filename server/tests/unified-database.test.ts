import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unifiedMigrations } from "./helpers/database";
import snapshot from "./fixtures/database-schema.json";
const db = new PGlite();
const user = "00000000-0000-4000-8000-000000000001";
const school = "00000000-0000-4000-8000-000000000010";
beforeAll(async () => {
  await db.exec("create schema app_private;");
  for (const statement of snapshot.enums) await db.exec(statement);
  for (const statement of snapshot.tables) {
    try {
      await db.exec(statement);
    } catch (e) {
      throw new Error(statement.slice(0, 500), { cause: e });
    }
  }
  for (const statement of snapshot.constraints.filter(
    (s) => !s.includes("FOREIGN KEY"),
  ))
    await db.exec(statement);
  for (const statement of snapshot.constraints.filter((s) =>
    s.includes("FOREIGN KEY"),
  ))
    await db.exec(statement);
  // Production schema-only snapshot: no user rows, passwords or credentials.
  for (const statement of snapshot.indexes) {
    try {
      await db.exec(statement);
    } catch (e) {
      if ((e as { code?: string }).code !== "42P07") throw e;
    }
  }
  for (const statement of snapshot.functions) await db.exec(statement);
  for (const statement of snapshot.triggers) await db.exec(statement);
  for (const name of unifiedMigrations) {
    try {
      await db.exec(
        readFileSync(
          fileURLToPath(
            new URL("../../database/neon/migrations/" + name, import.meta.url),
          ),
          "utf8",
        ),
      );
    } catch (e) {
      throw new Error(name + ": " + String(e), { cause: e });
    }
  }
  await db.query(
    `insert into public.users(id,email,password_hash,updated_at) values($1,'test@example.invalid','test-only-not-a-password',now())`,
    [user],
  );
  await db.query(
    `insert into public.universities(id,name,slug,updated_at) values($1,'Test University','test-university',now())`,
    [school],
  );
}, 60000);
afterAll(async () => {
  await db.close();
});
describe("cohort election and announcement invariants", () => {
  const faculty = "00000000-0000-4000-8000-000000000020",
    department = "00000000-0000-4000-8000-000000000030",
    cohort = "00000000-0000-4000-8000-000000000040",
    election = "00000000-0000-4000-8000-000000000050",
    other = "00000000-0000-4000-8000-000000000002";
  beforeAll(async () => {
    await db.query(
      `insert into public.faculties(id,university_id,name,slug,updated_at) values($1,$2,'Engineering','engineering',now())`,
      [faculty, school],
    );
    await db.query(
      `insert into public.departments(id,faculty_id,name,slug,updated_at) values($1,$2,'Computer engineering','cpe',now())`,
      [department, faculty],
    );
    await db.query(
      `insert into public.users(id,email,password_hash,updated_at) values($1,'another@example.invalid','test-only-not-a-password',now())`,
      [other],
    );
    for (const [i, member] of [user, other].entries())
      await db.query(
        `insert into public.profiles(id,user_id,username,display_name,university_id,department_id,updated_at) values(gen_random_uuid(),$1,$2,'Test student',$3,$4,now())`,
        [member, "test" + i, school, department],
      );
    await db.query(
      `insert into public.cohort_communities(id,institution_id,department_id,admission_year,name,level_code) values($1,$2,$3,2026,'CPE 2026','100')`,
      [cohort, school, department],
    );
    for (const member of [user, other])
      await db.query(
        `insert into public.community_members(community_id,user_id) values($1,$2)`,
        [cohort, member],
      );
    await db.query(
      `insert into public.community_elections(id,community_id,starts_at,ends_at,created_by) values($1,$2,now()-interval '1 day',now()+interval '29 days',$3)`,
      [election, cohort, user],
    );
  });
  it("rejects self-declared membership for nomination and voting", async () => {
    await expect(
      db.query("select app_private.community_participate($1,$2,null)", [
        election,
        user,
      ]),
    ).rejects.toThrow("VERIFIED_MEMBERSHIP_REQUIRED");
  });
  it("records one ballot even if a client retries", async () => {
    await db.query(
      "update public.community_members set verified_at=now() where community_id=$1",
      [cohort],
    );
    await db.query("select app_private.community_participate($1,$2,null)", [
      election,
      user,
    ]);
    await db.query("select app_private.community_participate($1,$2,$3)", [
      election,
      other,
      user,
    ]);
    await db.query("select app_private.community_participate($1,$2,$3)", [
      election,
      other,
      user,
    ]);
    expect(
      (
        await db.query(
          "select * from app_private.community_votes where election_id=$1",
          [election],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("cannot finalize before the deadline", async () => {
    await expect(
      db.query("select app_private.finalize_community_election($1)", [
        election,
      ]),
    ).rejects.toThrow("ELECTION_NOT_DUE");
  });
  it("closes once and installs exactly the winning rep", async () => {
    await db.query(
      `update public.community_elections set ends_at=now()-interval '1 second' where id=$1`,
      [election],
    );
    await db.query("select app_private.finalize_community_election($1)", [
      election,
    ]);
    await db.query("select app_private.finalize_community_election($1)", [
      election,
    ]);
    const r = await db.query<{ rep_user_id: string }>(
      "select rep_user_id from public.cohort_communities where id=$1",
      [cohort],
    );
    expect(r.rows[0]?.rep_user_id).toBe(user);
    await expect(
      db.query("select app_private.community_participate($1,$2,$3)", [
        election,
        user,
        user,
      ]),
    ).rejects.toThrow("ELECTION_NOT_OPEN");
  });
  it("rejects a non-rep announcement and deduplicates a rep retry", async () => {
    const key = "00000000-0000-4000-8000-000000000060";
    await expect(
      db.query(
        "select app_private.publish_community_announcement($1,$2,$3,$4,$5)",
        [cohort, other, "Class cancelled", "See you next week.", key],
      ),
    ).rejects.toThrow("COURSE_REP_REQUIRED");
    for (let i = 0; i < 2; i++)
      await db.query(
        "select app_private.publish_community_announcement($1,$2,$3,$4,$5)",
        [cohort, user, "Class cancelled", "See you next week.", key],
      );
    expect(
      (
        await db.query(
          "select id from public.community_announcements where community_id=$1",
          [cohort],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.in_app_notifications where dedupe_key like 'announcement:%'",
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("retains history and stops publishing after graduation", async () => {
    await db.query(
      "update public.cohort_communities set archived_at=now() where id=$1",
      [cohort],
    );
    await expect(
      db.query(
        "select app_private.publish_community_announcement($1,$2,$3,$4,gen_random_uuid())",
        [cohort, user, "A new update", "A new class update."],
      ),
    ).rejects.toThrow("COURSE_REP_REQUIRED");
    expect(
      (
        await db.query(
          "select id from public.community_announcements where community_id=$1",
          [cohort],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
describe("unified additive migration against production schema", () => {
  it("blocks direct anonymous access to new sensitive tables", async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname in ('agent_application_details','media_objects','support_requests')`,
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it("does not increment a streak twice in one campus day", async () => {
    await db.query("select * from app_private.check_in_streak($1)", [user]);
    const r = await db.query<{ current_days: number }>(
      "select * from app_private.check_in_streak($1)",
      [user],
    );
    expect(r.rows[0]?.current_days).toBe(1);
  });
  it("copies courses with blank units and grades, and wraps a midnight reminder", async () => {
    await db.query(
      `insert into public.timetable_entries(id,user_id,university_id,title,course_code,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled) values('00000000-0000-4000-8000-000000000100',$1,$2,'Introduction to computing','CPE 101',1,'00:05','01:00',15,true)`,
      [user, school],
    );
    const c = await db.query<{ units: unknown; grade: unknown }>(
      "select units,grade from public.course_drafts where user_id=$1",
      [user],
    );
    expect(c.rows[0]).toEqual({ units: null, grade: null });
    const a = await db.query<{ days: number[]; time: string }>(
      "select days,time::text from public.student_alarms where user_id=$1",
      [user],
    );
    expect(a.rows[0]).toEqual({ days: [0], time: "23:50:00" });
  });
  it("updates one alarm instead of duplicating it", async () => {
    await db.query(
      `update public.timetable_entries set starts_at='08:00',ends_at='09:00' where user_id=$1`,
      [user],
    );
    const a = await db.query<{ time: string }>(
      "select time::text from public.student_alarms where user_id=$1",
      [user],
    );
    expect(a.rows).toEqual([{ time: "07:45:00" }]);
  });
  it("removes the class alarm when a class is archived but keeps its course draft", async () => {
    await db.query(
      `update public.timetable_entries set status='ARCHIVED' where user_id=$1`,
      [user],
    );
    expect(
      (
        await db.query(
          "select id from public.student_alarms where user_id=$1",
          [user],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select course_code from public.course_drafts where user_id=$1",
          [user],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
