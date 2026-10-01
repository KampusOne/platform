-- Public academic directory only. No student, profile, order or message rows.
select json_build_object(
  'universities', (select json_agg(u) from public.universities u),
  'faculties', (select json_agg(f) from public.faculties f),
  'departments', (select json_agg(d) from public.departments d),
  'courses', (select json_agg(c) from public.courses c)
) as catalogue_snapshot;
