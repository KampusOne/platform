import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";

import { resolveAdminScope } from "../lib/admin-access";
import { recordAudit } from "../lib/audit";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { id, input } from "../lib/input";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const campusAdminRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

const campusStatus = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const campusCategory = z.enum([
  "ACADEMIC",
  "SERVICE",
  "TRANSPORT",
  "HOSTEL",
  "FOOD",
  "HEALTH",
  "SPORT",
]);

campusAdminRoutes.use("/*", requireAuth);

campusAdminRoutes.get("/", async (context) => {
  const scope = await resolveAdminScope(
    context.env,
    currentUser(context),
    context.req.query("universityId"),
    "universities.view",
  );
  const rows = await database(context.env).execute(sql`
    select id, institution_id, name, slug, latitude, longitude, map_style, source_url, status
    from public.institution_campuses
    where (${scope}::uuid is null or institution_id = ${scope}::uuid)
    order by name
    limit 300
  `);
  return context.json({ campuses: rows.rows });
});

campusAdminRoutes.post("/", async (context) => {
  const data = await input(
    context,
    z
      .object({
        id: z.string().uuid().optional(),
        universityId: z.string().uuid(),
        name: z.string().trim().min(2).max(120),
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(120),
        status: campusStatus.default("DRAFT"),
        latitude: z.number().min(-90).max(90).nullable().default(null),
        longitude: z.number().min(-180).max(180).nullable().default(null),
        mapStyle: z.enum(["KAMPUSONE", "SATELLITE"]).default("KAMPUSONE"),
        sourceUrl: z.string().url().nullable().default(null),
      })
      .strict()
      .refine(
        (value) => (value.latitude === null) === (value.longitude === null),
        "Provide both coordinates or leave both blank.",
      ),
  );

  const user = currentUser(context);
  await resolveAdminScope(
    context.env,
    user,
    data.universityId,
    "universities.manage",
  );

  const target = data.id ?? crypto.randomUUID();
  const result = firstRow(
    await database(context.env).execute(sql`
      insert into public.institution_campuses(
        id, institution_id, name, slug, status, latitude, longitude, map_style, source_url
      )
      values(
        ${target}::uuid, ${data.universityId}::uuid, ${data.name}, ${data.slug},
        ${data.status}, ${data.latitude}, ${data.longitude}, ${data.mapStyle}, ${data.sourceUrl}
      )
      on conflict(id) do update set
        name = excluded.name,
        slug = excluded.slug,
        status = excluded.status,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        map_style = excluded.map_style,
        source_url = excluded.source_url,
        updated_at = now()
      where institution_campuses.institution_id = excluded.institution_id
      returning id
    `),
  );

  if (!result) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "This campus is outside the selected university.",
    );
  }

  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "campus.saved",
    targetType: "campus",
    targetId: target,
    requestId: context.get("requestId"),
  });

  return context.json(result, 201);
});

campusAdminRoutes.get("/:id/places", async (context) => {
  const campusId = id(context.req.param("id"));
  const campus = firstRow(
    await database(context.env).execute<{ institution_id: string }>(sql`
      select institution_id
      from public.institution_campuses
      where id = ${campusId}::uuid
    `),
  );

  if (!campus) throw new AppError(404, "NOT_FOUND", "Campus not found.");

  await resolveAdminScope(
    context.env,
    currentUser(context),
    campus.institution_id,
    "universities.view",
  );

  return context.json({
    places: (
      await database(context.env).execute(sql`
        select id, name, category, description, latitude, longitude,
          accessibility_notes, image_url, parent_place_id, floor_label,
          room_label, search_aliases, status
        from public.campus_places
        where campus_id = ${campusId}::uuid
        order by name
        limit 500
      `)
    ).rows,
  });
});

campusAdminRoutes.post("/:id/places", async (context) => {
  const campusId = id(context.req.param("id"));
  const user = currentUser(context);
  const db = database(context.env);
  const campus = firstRow(
    await db.execute<{ institution_id: string }>(sql`
      select institution_id
      from public.institution_campuses
      where id = ${campusId}::uuid
    `),
  );

  if (!campus) throw new AppError(404, "NOT_FOUND", "Campus not found.");

  await resolveAdminScope(
    context.env,
    user,
    campus.institution_id,
    "universities.manage",
  );

  const data = await input(
    context,
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(180),
        category: campusCategory.optional(),
        description: z.string().trim().max(2000).default(""),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        accessibilityNotes: z.string().trim().max(1000).optional(),
        imageUrl: z.string().url().nullable().optional(),
        parentId: z.string().uuid().nullable().default(null),
        floor: z.string().trim().max(40).default(""),
        room: z.string().trim().max(40).default(""),
        aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        status: campusStatus.default("DRAFT"),
      })
      .strict()
      .refine(
        (value) =>
          (value.latitude === undefined && value.longitude === undefined) ||
          (value.latitude !== undefined &&
            value.longitude !== undefined &&
            (value.latitude === null) === (value.longitude === null)),
        "Provide both coordinates, clear both, or omit both.",
      ),
  );

  if (
    data.parentId &&
    !firstRow(
      await db.execute(sql`
        select id
        from public.campus_places
        where id = ${data.parentId}::uuid
          and campus_id = ${campusId}::uuid
          and parent_place_id is null
          and id <> ${data.id ?? "00000000-0000-0000-0000-000000000000"}::uuid
      `),
    )
  ) {
    throw new AppError(400, "BAD_REQUEST", "Choose a building on this campus.");
  }

  if (
    data.id &&
    data.parentId &&
    firstRow(
      await db.execute(sql`
        select id
        from public.campus_places
        where parent_place_id = ${data.id}::uuid
        limit 1
      `),
    )
  ) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "A building containing offices cannot become an office.",
    );
  }

  const target = data.id ?? crypto.randomUUID();
  const categoryForInsert =
    data.category ?? (data.parentId ? "SERVICE" : "ACADEMIC");
  const preserveCategory = data.id !== undefined && data.category === undefined;
  const preserveCoordinates =
    data.id !== undefined &&
    data.latitude === undefined &&
    data.longitude === undefined;
  const preserveAccessibility =
    data.id !== undefined && data.accessibilityNotes === undefined;
  const preserveImage = data.id !== undefined && data.imageUrl === undefined;

  const result = firstRow(
    await db.execute(sql`
      insert into public.campus_places(
        id, university_id, campus_id, name, category, description,
        latitude, longitude, accessibility_notes, image_url,
        parent_place_id, floor_label, room_label, search_aliases, status
      )
      values(
        ${target}::uuid, ${campus.institution_id}::uuid, ${campusId}::uuid,
        ${data.name}, ${categoryForInsert}, ${data.description},
        ${data.latitude ?? null}, ${data.longitude ?? null},
        ${data.accessibilityNotes ?? null}, ${data.imageUrl ?? null},
        ${data.parentId}::uuid, ${data.floor}, ${data.room},
        ${sql.param(data.aliases)}::text[], ${data.status}
      )
      on conflict(id) do update set
        name = excluded.name,
        category = case when ${preserveCategory} then campus_places.category else excluded.category end,
        description = excluded.description,
        latitude = case when ${preserveCoordinates} then campus_places.latitude else excluded.latitude end,
        longitude = case when ${preserveCoordinates} then campus_places.longitude else excluded.longitude end,
        accessibility_notes = case when ${preserveAccessibility} then campus_places.accessibility_notes else excluded.accessibility_notes end,
        image_url = case when ${preserveImage} then campus_places.image_url else excluded.image_url end,
        parent_place_id = excluded.parent_place_id,
        floor_label = excluded.floor_label,
        room_label = excluded.room_label,
        search_aliases = excluded.search_aliases,
        status = excluded.status,
        updated_at = now()
      where campus_places.campus_id = excluded.campus_id
      returning id
    `),
  );

  if (!result) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "This place is outside the selected campus.",
    );
  }

  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: campus.institution_id,
    action: "campus.place.saved",
    targetType: "campus_place",
    targetId: target,
    requestId: context.get("requestId"),
  });

  return context.json(result, 201);
});
