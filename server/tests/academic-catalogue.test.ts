import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { testDatabaseAdapter } from "./helpers/database";
import { academicCatalogue } from "../src/lib/academic-catalogue";
import type { Bindings, Variables } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({ database: () => testDatabaseAdapter(db) }));
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.get("/catalog", academicCatalogue);
const U1 = "81000000-0000-4000-8000-000000000001", U2 = "81000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table universities(id uuid primary key,name text,slug text,country text,state text,deleted_at timestamp,catalogue_metadata jsonb default '{}');
    create table faculties(id uuid primary key,university_id uuid,name text,slug text,deleted_at timestamp);
    create table departments(id uuid primary key,faculty_id uuid,name text,slug text,deleted_at timestamp);
    create table courses(id uuid primary key,department_id uuid,name text,code text,deleted_at timestamp);
    insert into universities values('${U1}','University of Benin','uniben','Nigeria',null,null,'{"aliases":["UNIBEN"]}'),('${U2}','Ahmadu Bello University, Zaria','abu','Nigeria',null,null,'{"aliases":["ABU"]}');
    insert into faculties values('${U1}','${U1}','Engineering','engineering',null),('${U2}','${U2}','Education','education',null);
    insert into departments values('${U1}','${U1}','Computer Engineering','computer-engineering',null),('${U2}','${U2}','Science Education','science-education',null);
    insert into courses values('${U1}','${U1}','Computer Engineering',null,null),('${U2}','${U2}','Biology Education',null,null);
  `);
}, 30000);
afterAll(async () => db?.close());
it("loads all institutions without downloading all academic units", async () => {
  const data = await (await app.request("https://test.invalid/catalog?institutionsOnly=true")).json();
  expect(data.universities).toHaveLength(2);
  expect(data.faculties).toEqual([]);
  expect(data.departments).toEqual([]);
  expect(data.courses).toEqual([]);
});
it("loads selected-school relationships, alias search, and excludes deleted ancestry", async () => {
  const data = await (await app.request(`https://test.invalid/catalog?universityId=${U2}&q=ABU`)).json();
  expect(data.universities.map((row: { id: string }) => row.id)).toEqual([U2]);
  expect(data.faculties.map((row: { id: string }) => row.id)).toEqual([U2]);
  expect(data.departments.map((row: { id: string }) => row.id)).toEqual([U2]);
  expect(data.courses.map((row: { id: string }) => row.id)).toEqual([U2]);
  await db.query("update faculties set deleted_at=now() where id=$1", [U2]);
  const archived = await (await app.request(`https://test.invalid/catalog?universityId=${U2}`)).json();
  expect(archived.faculties).toEqual([]); expect(archived.departments).toEqual([]); expect(archived.courses).toEqual([]);
  expect(archived.coverage.nationwideStructureComplete).toBe(false);
});
