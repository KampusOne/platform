import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "@kampusone/contracts";
import { database } from "./database";
import { AppError } from "./errors";
import type { Bindings, Variables } from "../types";

/** Registration is independent of whether marketplace/map services are live. */
export async function academicCatalogue(context: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const requestedUniversity = context.req.query("universityId");
  if (requestedUniversity && !z.string().uuid().safeParse(requestedUniversity).success) {
    throw new AppError(400, "BAD_REQUEST", "Choose a valid university.");
  }
  const universityId = requestedUniversity || null;
  const institutionsOnly = context.req.query("institutionsOnly") === "true";
  const query = (context.req.query("q") || "").trim().slice(0, 120);
  const needle = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const db = database(context.env);
  const empty = Promise.resolve({ rows: [] });
  const [universities, faculties, departments, courses] = await Promise.all([
    db.execute(sql`
      select u.id,u.name,u.slug,u.country,u.state,
        coalesce(to_jsonb(u)->'catalogue_metadata'->'aliases','[]'::jsonb) as aliases,
        to_jsonb(u)->'catalogue_metadata'->>'source_url' as source_url,
        to_jsonb(u)->'catalogue_metadata'->>'retrieved_at' as source_retrieved_at
      from public.universities u where u.deleted_at is null
        and (${query}='' or u.name ilike ${needle} or u.slug ilike ${needle}
          or coalesce(to_jsonb(u)->'catalogue_metadata'->'aliases','[]'::jsonb)::text ilike ${needle})
      order by u.name
    `),
    institutionsOnly ? empty : db.execute(sql`
      select f.id,f.university_id,f.name,f.slug,
        to_jsonb(f)->'catalogue_metadata'->>'source_url' as source_url
      from public.faculties f join public.universities u on u.id=f.university_id
      where f.deleted_at is null and u.deleted_at is null
        and (${universityId}::uuid is null or f.university_id=${universityId}::uuid)
      order by f.name
    `),
    institutionsOnly ? empty : db.execute(sql`
      select d.id,d.faculty_id,d.name,d.slug,
        to_jsonb(d)->'catalogue_metadata'->>'source_url' as source_url
      from public.departments d join public.faculties f on f.id=d.faculty_id
        join public.universities u on u.id=f.university_id
      where d.deleted_at is null and f.deleted_at is null and u.deleted_at is null
        and (${universityId}::uuid is null or f.university_id=${universityId}::uuid)
      order by d.name
    `),
    institutionsOnly ? empty : db.execute(sql`
      select c.id,c.department_id,c.name,c.code,
        to_jsonb(c)->>'normal_duration_years' as normal_duration_years,
        to_jsonb(c)->>'award' as award
      from public.courses c join public.departments d on d.id=c.department_id
        join public.faculties f on f.id=d.faculty_id join public.universities u on u.id=f.university_id
      where c.deleted_at is null and d.deleted_at is null and f.deleted_at is null and u.deleted_at is null
        and (${universityId}::uuid is null or f.university_id=${universityId}::uuid)
      order by c.name
    `),
  ]);
  // No claim of nationwide department completeness: reviewed gaps remain explicit.
  return context.json({
    universities: universities.rows, faculties: faculties.rows,
    departments: departments.rows, courses: courses.rows,
    coverage: { universityId, institutionsOnly, canSubmitMissingAcademic: true,
      facultyCount: faculties.rows.length, departmentCount: departments.rows.length,
      programmeCount: courses.rows.length, nationwideStructureComplete: false },
  });
}
