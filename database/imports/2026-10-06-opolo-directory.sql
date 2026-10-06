-- The named venue is sourced from the GDG on Campus organizer. The precise
-- entrance is not published until located; do not substitute UNIBEN's main pin.
insert into public.campus_places(university_id,campus_id,name,category,description,status,source_provider,source_url,search_aliases,confidence)
select '6a79211e-6e85-4d95-be24-976edb26ba58'::uuid,'1d60dcae-760d-4de7-8443-6a870d9bbe1a'::uuid,
 'Opolo Innovation Hub','ACADEMIC',
 'Opolo Hub at UNIBEN Ugbowo. Campus event organizers describe it as behind the Faculty of Education. Its precise entrance still needs mapping.',
 'PUBLISHED','KAMPUSONE',
 'https://gdg.community.dev/events/details/google-gdg-on-campus-university-of-benin-benin-nigeria-presents-flutter-forward-the-googlers-perspective/',
 array['Opolo Hub','Opolo','Innovation Hub'],0.6
where not exists(select 1 from public.campus_places where campus_id='1d60dcae-760d-4de7-8443-6a870d9bbe1a'::uuid and lower(name) like '%opolo%');
