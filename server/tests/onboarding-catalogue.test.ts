import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { app } from "../src/app";
import type { Bindings } from "../src/types";

let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
const university = "87000000-0000-4000-8000-000000000001";
const faculty = "87000000-0000-4000-8000-000000000002";
const department = "87000000-0000-4000-8000-000000000003";
const student = "87000000-0000-4000-8000-000000000004";
const env: Bindings = {
  ENVIRONMENT: "local", ALLOWED_ORIGINS: "https://app.example.invalid",
  MINIMUM_APP_VERSION: "1", MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true", SOCIAL_FEED_ENABLED: "false",
  MARKETPLACE_ENABLED: "false", PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false", UNIFIED_SCHEMA_READY: "true",
};
const migrations = [
  "20260927130000_multi_university_onboarding_catalogue",
  "20260927164000_publish_nigerian_university_identities",
  "20260928101500_onboarding_academic_structure",
];
async function applyCatalogue() {
  for (const version of migrations)
    await db.exec(readFileSync(new URL(`../../database/neon/migrations/${version}.sql`, import.meta.url), "utf8"));
}
type Catalogue = {
  universities: { id: string; name: string }[];
  faculties: { id: string; university_id: string }[];
  departments: { id: string; faculty_id: string }[];
  courses: { id: string; department_id: string }[];
};
async function catalogue(query: string) {
  const response = await app.request(`https://api.example.invalid/v1/student/catalog?${query}`, {}, env);
  expect(response.status).toBe(200);
  return await response.json() as Catalogue;
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'University of Benin','uniben',now())", [university]);
  await db.query("insert into public.faculties(id,university_id,name,slug,updated_at) values($1,$2,'Existing faculty','existing-faculty',now())", [faculty, university]);
  await db.query("insert into public.departments(id,faculty_id,name,slug,updated_at) values($1,$2,'Existing department','existing-department',now())", [department, faculty]);
  await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,'catalogue-fixture@example.invalid','test-only',now())", [student]);
  await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,faculty_id,department_id,updated_at) values(gen_random_uuid(),$1,'cataloguefixture','Catalogue fixture',$2,$3,$4,now())", [student, university, faculty, department]);
  await applyCatalogue();
}, 60000);
afterAll(async () => { await db?.close(); });

describe("university onboarding catalogue and pending academic migrations", () => {
  it("keeps the complete institution list while returning UNIBEN's own academic hierarchy", async () => {
    const list = await catalogue("institutionsOnly=true");
    expect(list.universities).toHaveLength(328);
    expect(list.faculties).toEqual([]);
    expect(list.departments).toEqual([]);
    const details = await catalogue(`universityId=${university}`);
    expect(details.universities.map(item => item.id)).toEqual([university]);
    expect(details.faculties.length).toBeGreaterThanOrEqual(20);
    expect(details.departments.length).toBeGreaterThanOrEqual(100);
    expect(details.faculties.every(item => item.university_id === university)).toBe(true);
    expect(details.departments.every(item => details.faculties.some(parent => parent.id === item.faculty_id))).toBe(true);
    expect(details.courses.every(item => details.departments.some(parent => parent.id === item.department_id))).toBe(true);
  });
  it("switches universities without carrying UNIBEN faculties or departments into another campus", async () => {
    const list = await catalogue("institutionsOnly=true");
    const minna = list.universities.find(item => item.name === "Federal University of Technology, Minna")!;
    const first = await catalogue(`universityId=${university}`);
    const second = await catalogue(`universityId=${minna.id}`);
    const again = await catalogue(`universityId=${university}`);
    expect(second.universities.map(item => item.id)).toEqual([minna.id]);
    expect(second.faculties.length).toBeGreaterThan(0);
    expect(second.departments.length).toBeGreaterThan(0);
    expect(second.faculties.every(item => item.university_id === minna.id)).toBe(true);
    expect(second.departments.every(item => second.faculties.some(parent => parent.id === item.faculty_id))).toBe(true);
    expect(second.faculties.some(item => first.faculties.some(original => original.id === item.id))).toBe(false);
    expect(again).toEqual(first);
  });
  it("preserves existing institution IDs, academic records and student selections across repeat imports", async () => {
    const before = (await db.query<{ id: string }>("select id from public.faculties union all select id from public.departments order by id")).rows;
    await applyCatalogue();
    expect((await db.query("select id from public.faculties union all select id from public.departments order by id")).rows).toEqual(before);
    expect((await db.query("select id,slug from public.universities where name='University of Benin'")).rows).toEqual([{ id: university, slug: "uniben" }]);
    expect((await db.query("select university_id,faculty_id,department_id from public.profiles where user_id=$1", [student])).rows).toEqual([{ university_id: university, faculty_id: faculty, department_id: department }]);
    expect((await db.query("select id from public.faculties where id=$1 and deleted_at is null", [faculty])).rows).toHaveLength(1);
    expect((await db.query("select id from public.departments where id=$1 and deleted_at is null", [department])).rows).toHaveLength(1);
  }, 30000);
});
