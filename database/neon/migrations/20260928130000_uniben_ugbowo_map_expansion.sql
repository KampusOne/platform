begin;

update public.institution_campuses campus
set
  latitude = 6.398255,
  longitude = 5.618838,
  map_style = 'KAMPUSONE',
  source_url = 'https://www.openstreetmap.org/#map=16/6.3983/5.6188',
  status = 'PUBLISHED',
  updated_at = now()
from public.universities uniben
where campus.institution_id = uniben.id
  and campus.slug = 'ugbowo'
  and lower(uniben.name) = 'university of benin'
  and uniben.deleted_at is null;

insert into public.content_sources(university_id, name, source_url, verified)
select
  uniben.id,
  'KampusOne UNIBEN Ugbowo map directory',
  'https://www.openstreetmap.org/#map=16/6.3983/5.6188',
  false
from public.universities uniben
where lower(uniben.name) = 'university of benin'
  and uniben.deleted_at is null
on conflict(university_id, name) do update set
  source_url = excluded.source_url;

create temporary table kampusone_uniben_ugbowo_seed (
  id uuid primary key,
  name text not null,
  category text not null,
  description text not null,
  latitude numeric not null,
  longitude numeric not null,
  aliases text[] not null,
  verified boolean not null
) on commit drop;

insert into kampusone_uniben_ugbowo_seed(
  id, name, category, description, latitude, longitude, aliases, verified
) values
  ('5a3e978c-8d07-411c-bd0d-1b08313fe128'::uuid,'Student Affairs Division','SERVICE','Student Affairs Division, University of Benin Ugbowo Campus.',6.400023::numeric,5.609885::numeric,array['Student Affairs','Dean of Students']::text[],true),
  ('280c87f4-139b-5504-ac0c-f910731ac64c'::uuid,'Main Gate','TRANSPORT','Primary Ugbowo campus entrance and student pickup landmark.',6.399920::numeric,5.608870::numeric,array['UNIBEN Main Gate','Main Entrance']::text[],true),
  ('7a85539d-13df-5d11-8c95-4cc878ef0657'::uuid,'Main Gate Bus Terminal','TRANSPORT','Campus bus and shuttle pickup area near the Main Gate.',6.399050::numeric,5.609320::numeric,array['Maingate Bus Terminal','Main Gate Bus Stop']::text[],false),
  ('dfb816ff-345c-5af0-80bc-0383f2c09fca'::uuid,'Maingate Shopping Complex','SERVICE','Student shopping and services complex near the Main Gate.',6.398288::numeric,5.610109::numeric,array['Main Gate Shopping Complex','Maingate Shops']::text[],true),
  ('52ecce2e-8dac-5b0f-92d6-212536be74a6'::uuid,'Student Guidance and Counselling Centre','SERVICE','Student Guidance and Counselling Centre near the old bookshop and student halls.',6.396750::numeric,5.619180::numeric,array['Guidance and Counselling','Counselling Centre']::text[],false),
  ('9f040cce-eb71-572a-8dd8-15cbe7799b19'::uuid,'Main Auditorium','SERVICE','University of Benin Main Auditorium.',6.399710::numeric,5.613300::numeric,array['UNIBEN Main Auditorium','Auditorium']::text[],true),
  ('b446bddc-f6b7-5e4a-a6ef-6f96738a7759'::uuid,'Central Administration','SERVICE','Central administration area on Ugbowo Campus.',6.399450::numeric,5.612650::numeric,array['Central Admin','Administration Block','Registry']::text[],false),
  ('2be8a76a-ef9f-5a69-a3cc-3abbd5803bae'::uuid,'Exams and Records','SERVICE','Examinations and records office area.',6.399000::numeric,5.612100::numeric,array['Exams & Records','Records Office']::text[],false),
  ('63e1a25a-c6be-5386-b53d-aa4f0708db42'::uuid,'Bursary Department','SERVICE','University bursary and finance services.',6.398100::numeric,5.616850::numeric,array['Bursary','UNIBEN Bursary']::text[],false),
  ('b22357c9-2fdd-51ea-8861-6fefa3fef4a0'::uuid,'University of Benin Microfinance Bank','SERVICE','University of Benin Microfinance Bank campus branch.',6.397760::numeric,5.617240::numeric,array['UNIBEN Microfinance Bank','UNIBEN MFB']::text[],false),
  ('265d648c-28db-54b4-8eb8-68ddc10a4aef'::uuid,'Wema Bank - UNIBEN','SERVICE','Wema Bank branch on Ugbowo Campus.',6.400856::numeric,5.610236::numeric,array['Wema Bank','Wema UNIBEN']::text[],true),
  ('c503e423-4b99-5e36-bf3c-dec9ca03406a'::uuid,'Guaranty Trust Bank - UNIBEN','SERVICE','Guaranty Trust Bank campus branch.',6.400863::numeric,5.610953::numeric,array['GTBank','GTB UNIBEN','Guaranty Trust Bank']::text[],true),
  ('7fe547f4-1a71-53f0-b674-4c545b41d3c2'::uuid,'Stanbic IBTC Bank - UNIBEN','SERVICE','Stanbic IBTC branch on Ugbowo Campus.',6.400460::numeric,5.611460::numeric,array['Stanbic IBTC','Stanbic UNIBEN']::text[],false),
  ('ed6428c9-1102-5cd6-9631-db9ec91dbc2e'::uuid,'Fidelity Bank - UNIBEN','SERVICE','Fidelity Bank branch on Ugbowo Campus.',6.400210::numeric,5.611780::numeric,array['Fidelity Bank','Fidelity UNIBEN']::text[],false),
  ('84973da3-033f-5192-9bc6-f76ff76d428c'::uuid,'First Bank - UNIBEN','SERVICE','First Bank branch on Ugbowo Campus.',6.399980::numeric,5.611360::numeric,array['First Bank','FirstBank UNIBEN']::text[],false),
  ('2ecc6e0e-ce20-5720-baea-d46173dd6a35'::uuid,'Zenith Bank - UNIBEN','SERVICE','Zenith Bank branch on Ugbowo Campus.',6.400720::numeric,5.611250::numeric,array['Zenith Bank','Zenith UNIBEN']::text[],false),
  ('24387c80-2642-5a4c-b9d4-29006e7bf9e2'::uuid,'All Saints Chapel','SERVICE','Christian worship centre on Ugbowo Campus.',6.398900::numeric,5.611700::numeric,array['All Saints Chapel UNIBEN']::text[],false),
  ('20be3e9f-67e0-5fe8-989e-4ef0f4ff197e'::uuid,'St. Albert Catholic Church','SERVICE','Catholic worship centre on Ugbowo Campus.',6.398520::numeric,5.612300::numeric,array['Saint Albert Catholic Church','St Albert']::text[],false),
  ('c35d97e3-bed1-5643-8f3e-7f24fb879a2e'::uuid,'UNIBEN Mosque','SERVICE','Campus mosque near the student halls.',6.396900::numeric,5.619300::numeric,array['Students Mosque','Mosque']::text[],false),
  ('a64fc253-2c9e-407c-b852-b077e0390d5b'::uuid,'Faculty of Engineering','ACADEMIC','Faculty of Engineering, University of Benin Ugbowo Campus.',6.401790::numeric,5.615370::numeric,array['Engineering','Engr']::text[],true),
  ('3a19a50f-6dae-5f4e-a6fd-cac0d4df55e4'::uuid,'Department of Chemical Engineering','ACADEMIC','Department of Chemical Engineering in the Engineering cluster.',6.402250::numeric,5.615720::numeric,array['Chemical Engineering','Chem Eng']::text[],false),
  ('e5b0f8af-acb2-505b-ac88-000ef4acc477'::uuid,'Mechanical Production Laboratory','ACADEMIC','Mechanical Production laboratory in the Engineering cluster.',6.402070::numeric,5.616080::numeric,array['Mechanical Production Lab','Mechanical Lab']::text[],false),
  ('175bb188-292f-5058-9500-016f43014378'::uuid,'Engineering Old 1000 LT','ACADEMIC','Large lecture theatre in the Engineering area.',6.401350::numeric,5.614920::numeric,array['Old 1000 LT','Engineering 1000 LT']::text[],false),
  ('4abd5761-6388-46f0-b20d-e3aef1f4f1c2'::uuid,'Faculty of Physical Sciences','ACADEMIC','Faculty of Physical Sciences, University of Benin Ugbowo Campus.',6.400310::numeric,5.615350::numeric,array['Physical Science','Physical Sciences']::text[],true),
  ('71329ef0-fcc7-5931-96f9-bf100342a72e'::uuid,'1000 LT Faculty of Physical Sciences','ACADEMIC','Large lecture theatre serving Physical Sciences.',6.400720::numeric,5.617000::numeric,array['Physical Science 1000 LT','1000LT']::text[],false),
  ('65fdfcdf-50c1-5f53-83ff-28d7558fc506'::uuid,'Computer Science Department','ACADEMIC','Computer Science Department, Ugbowo Campus.',6.401180::numeric,5.617220::numeric,array['Computer Science','Computer Science Department UNIBEN']::text[],false),
  ('fe6bd15a-4934-59cd-9233-99fc40970a66'::uuid,'UNIBEN International ICT Centre','SERVICE','University ICT centre and digital services hub.',6.400938::numeric,5.616359::numeric,array['ICT Centre','ICTU','CRPU','Iyayi Computer Building']::text[],true),
  ('f61bd3ec-dbdf-498d-aaab-c867c8c77522'::uuid,'Faculty of Life Sciences','ACADEMIC','Faculty of Life Sciences, University of Benin Ugbowo Campus.',6.398940::numeric,5.614870::numeric,array['Life Science','Life Sciences']::text[],true),
  ('6a656590-974f-5ac8-ba5b-6a660e4ddf8d'::uuid,'Faculty of Life Sciences Dean''s Office','ACADEMIC','Dean''s Office for the Faculty of Life Sciences.',6.398620::numeric,5.615650::numeric,array['Life Science Dean Office','Dean''s Office Life Science']::text[],false),
  ('724a8afe-20bb-56ce-987c-191ec01a7f03'::uuid,'PBB and AEB Laboratories','ACADEMIC','Life Sciences PBB, MCB and AEB laboratory cluster.',6.398160::numeric,5.616000::numeric,array['PBB Labs','AEB Labs','MCB','Faculty of Life Science Labs']::text[],false),
  ('5aeff0e1-9df2-5e13-8c3f-a3b5005a2c01'::uuid,'Department of Biochemistry','ACADEMIC','Department of Biochemistry, Ugbowo Campus.',6.396250::numeric,5.615050::numeric,array['Biochemistry','Department of Biochemistry UNIBEN']::text[],false),
  ('eb15b248-b922-50a8-a532-4d734a480f2a'::uuid,'Physical Science Shopping Complex','SERVICE','Student food, stationery and everyday services near Physical Sciences.',6.399563::numeric,5.616578::numeric,array['Physical Science Shops','Physical Science Shopping']::text[],true),
  ('34ae9089-799b-5cb9-8ddc-5026d572faea'::uuid,'Life Science Shopping Complex','SERVICE','Student shopping and food services near Life Sciences.',6.397238::numeric,5.615359::numeric,array['Life Science Shops','Life Science Shopping']::text[],true),
  ('59368a84-86d1-5c4f-81a8-bdd6ef111e85'::uuid,'Basement Shopping Complex','SERVICE','Student shopping and service complex known as Basement.',6.396638::numeric,5.615109::numeric,array['Basement','Students Complex']::text[],true),
  ('1a926f1d-222c-581a-80a0-b1d6042e4867'::uuid,'John Harris Library','ACADEMIC','Main academic library on Ugbowo Campus.',6.396660::numeric,5.616687::numeric,array['JHL','Main Library','John Harris']::text[],true),
  ('3c9fcb8e-39ff-51f1-a796-07126e17decb'::uuid,'John Harris Library Extension','ACADEMIC','John Harris Library extension and e-learning spaces.',6.396930::numeric,5.616520::numeric,array['Library Extension','Donald Partridge e-Learning Centre','MTNF e-Library']::text[],false),
  ('c1a6b966-0cec-427d-8672-fe1df10ae369'::uuid,'Faculty of Education','ACADEMIC','Faculty of Education, University of Benin Ugbowo Campus.',6.400910::numeric,5.619670::numeric,array['Education']::text[],true),
  ('e2d8ea45-9bc9-5789-8133-1cb55893e588'::uuid,'UNIBEN Education Field','SPORT','Open sports and activity field near the Education and Engineering areas.',6.402480::numeric,5.618650::numeric,array['Education Field','Faculty of Education Field']::text[],false),
  ('9ee9eac7-eeee-5da5-bc97-a0cb34f4b9b5'::uuid,'Faculty of Management Sciences','ACADEMIC','Faculty of Management Sciences building.',6.399200::numeric,5.618050::numeric,array['Management Sciences','Management Science']::text[],false),
  ('e1ab63c1-5fbd-4a41-9a4d-f2c0b18d7fae'::uuid,'Faculty of Law','ACADEMIC','Faculty of Law, University of Benin Ugbowo Campus.',6.400530::numeric,5.622440::numeric,array['Law']::text[],true),
  ('60cfd3e2-6db6-581a-9048-76b057103a11'::uuid,'Faculty of Arts','ACADEMIC','Faculty of Arts, University of Benin Ugbowo Campus.',6.403300::numeric,5.622170::numeric,array['Arts','Faculty Arts']::text[],true),
  ('338d121f-da2a-5d76-8a41-fcd266804cb4'::uuid,'Old Faculty of Agriculture','ACADEMIC','Older Faculty of Agriculture building east of the Law area.',6.400500::numeric,5.623430::numeric,array['Old Agric','Old Agriculture']::text[],false),
  ('d345d3fc-8c25-5a23-88d7-22b34b4d4376'::uuid,'New Faculty of Agriculture','ACADEMIC','New Faculty of Agriculture building.',6.403350::numeric,5.619650::numeric,array['New Agric','Agriculture']::text[],false),
  ('25931066-ecde-5af0-89c0-ef9a84a30343'::uuid,'Faculty of Agriculture Shopping Mall','SERVICE','Student shopping area serving the Agriculture and Hall 4 axis.',6.399050::numeric,5.622850::numeric,array['Agric Shopping Mall','Agriculture Shopping']::text[],false),
  ('c3928d61-f327-557e-a243-b5c3ae7bec19'::uuid,'Faculty of Environmental Sciences','ACADEMIC','Faculty of Environmental Sciences campus building.',6.402800::numeric,5.620650::numeric,array['Environmental Science','Environmental Sciences']::text[],false),
  ('9ce6c230-f7c3-526b-adbe-e819e81ec85b'::uuid,'Centre for Entrepreneurship Development','ACADEMIC','University entrepreneurship teaching and development centre.',6.402080::numeric,5.621250::numeric,array['Entrepreneurship Centre','CED']::text[],false),
  ('886362e8-0aae-5388-9579-d03a7d177a46'::uuid,'Petroleum and Energy Research Centre','ACADEMIC','Petroleum and energy research centre.',6.403050::numeric,5.620050::numeric,array['Petroleum Research Centre','Energy Research Centre']::text[],false),
  ('680a996b-b27f-5bda-b76e-9ea577cf9022'::uuid,'Centre of Excellence in Geosciences and Petroleum Engineering','ACADEMIC','Geosciences and petroleum engineering centre.',6.401850::numeric,5.623500::numeric,array['Centre of Excellence in Geosciences','Geosciences Centre']::text[],false),
  ('6ada12ab-8e39-5938-8a6c-83f4ba5083f5'::uuid,'Central Research Laboratory','ACADEMIC','University of Benin Central Research Laboratory.',6.403954::numeric,5.618651::numeric,array['CRL','Central Research Lab']::text[],true),
  ('fb6d80b0-d0a7-5812-8790-0a1fb32ae423'::uuid,'University of Benin Staff School','ACADEMIC','University staff school on the Ugbowo campus axis.',6.404250::numeric,5.620350::numeric,array['UNIBEN Staff School','Staff School']::text[],false),
  ('ab8fedb8-6f20-54fd-b543-22896f4e9d5b'::uuid,'University Demonstration Secondary School','ACADEMIC','University Demonstration Secondary School.',6.404050::numeric,5.617550::numeric,array['UDSS','University Demonstration School']::text[],false),
  ('f66a29bf-08dc-43b6-be7a-d66c099613a5'::uuid,'JUPEB Foundation School','ACADEMIC','UNIBEN JUPEB Foundation School, Ugbowo Campus.',6.397003::numeric,5.617815::numeric,array['JUPEB','Foundation School','JUPEB Building']::text[],true),
  ('f75b3456-471d-55c0-b64d-63b4a885086e'::uuid,'Festus Iyayi Hall','ACADEMIC','Large lecture and event hall in the central academic area.',6.398438::numeric,5.617391::numeric,array['Festus Iyayi Hall','Iyayi Hall']::text[],true),
  ('eb6b62e3-7ccc-5739-a727-bddccc0f70df'::uuid,'Faculty of Pharmacy','ACADEMIC','Faculty of Pharmacy, Ugbowo Campus.',6.396050::numeric,5.620350::numeric,array['Pharmacy','Faculty Pharmacy']::text[],false),
  ('bb931009-6d8b-5647-88ec-3603b720f8d9'::uuid,'Pharmacy Annex','ACADEMIC','Pharmacy teaching annex near the medical and hostel axis.',6.395700::numeric,5.620220::numeric,array['Pharmacy Annex UNIBEN']::text[],false),
  ('fd9c8337-c8ce-593b-a3f0-616c261d5d32'::uuid,'Pharmacy Lecture Theatres','ACADEMIC','Lecture theatre cluster serving Pharmacy.',6.396180::numeric,5.619900::numeric,array['Pharmacy LT','Pharmacy Lecture Theater']::text[],false),
  ('b6476973-c5db-5d17-9464-25dae56e6774'::uuid,'School of Dentistry','ACADEMIC','School of Dentistry, University of Benin.',6.396400::numeric,5.624700::numeric,array['Dentistry','School Of Dentistry']::text[],false),
  ('7dddb9ff-df5d-5c1d-bd25-affb0df6ce11'::uuid,'Institute of Health Sciences and Technology','ACADEMIC','Health sciences and technology institute near the Main Gate axis.',6.397950::numeric,5.609050::numeric,array['Institute of Health Sciences','Health Sciences and Technology']::text[],false),
  ('5c706c07-9258-54ed-ab6b-ca29736a398a'::uuid,'University of Benin Health Centre','HEALTH','University health centre with student medical services.',6.403100::numeric,5.623510::numeric,array['Health Centre','Medical Centre']::text[],true),
  ('25f63f0f-4524-590c-9ac0-6fbe0b56a8ab'::uuid,'Medical Complex','HEALTH','Medical teaching and service complex on Ugbowo Campus.',6.395438::numeric,5.623172::numeric,array['Medical Complex UNIBEN']::text[],true),
  ('dcf11440-5c29-5b36-a05f-e7125d77d228'::uuid,'UNIBEN Anatomy Back Gate','TRANSPORT','Pedestrian access point near Anatomy and the medical hostel axis.',6.396200::numeric,5.617800::numeric,array['Anatomy Back Gate','Anatomy Gate']::text[],false),
  ('c3b9b0fc-00b8-537b-a417-a3989904a39e'::uuid,'Back Gate','TRANSPORT','Secondary campus access point on the eastern/southern campus edge.',6.395900::numeric,5.625200::numeric,array['UNIBEN Back Gate']::text[],false),
  ('6a96705f-809a-5276-85c8-20a9483704c6'::uuid,'Ekosodin Gate Security Post','SERVICE','Security post at the Ekosodin-side campus access.',6.404500::numeric,5.624700::numeric,array['Ekosodin Gate','Ekosodin Security Post']::text[],false),
  ('9ca0be2a-0ea6-5305-bebf-7b4315e6c1ad'::uuid,'Hall 1 Hostel','HOSTEL','Hall 1 (Queen Idia Hall), Ugbowo Campus.',6.396613::numeric,5.618672::numeric,array['Hall 1','Queen Idia Hostel','Queen Idia Hall']::text[],true),
  ('1e1ddc99-6b48-585c-8df5-fe25b9177045'::uuid,'Hall 2 Hostel','HOSTEL','Hall 2 (Madam Tinubu Hall), Ugbowo Campus.',6.398438::numeric,5.619672::numeric,array['Hall 2','Tinubu Female Hostel','Madam Tinubu Hall']::text[],true),
  ('95de09db-4898-589a-8496-4a3814294d66'::uuid,'Hall 3 Hostel','HOSTEL','Hall 3 (Mallam Aminu Kano Hall), Ugbowo Campus.',6.396913::numeric,5.619953::numeric,array['Hall 3','Aminu Kano Hostel','Mallam Aminu Kano Hall']::text[],true),
  ('bc5f982b-7509-566e-b62f-29fc7362175c'::uuid,'Hall 4 Hostel','HOSTEL','Hall 4 (Akanu Ibiam Hall), Ugbowo Campus.',6.398300::numeric,5.622550::numeric,array['Hall 4','Akanu Ibiam Hall']::text[],false),
  ('647a85ab-9396-45c4-b427-bebb7d3dcf3b'::uuid,'Hall 5 Hostel','HOSTEL','Hall 5 student hostel, University of Benin Ugbowo Campus.',6.397120::numeric,5.623920::numeric,array['Hall 5']::text[],true),
  ('68a12e6f-640c-4412-8cf6-63a5502d454c'::uuid,'Hall 6 Hostel','HOSTEL','Hall 6 student hostel, University of Benin Ugbowo Campus.',6.398220::numeric,5.626190::numeric,array['Hall 6']::text[],true),
  ('5931353c-3b42-4b13-a5f6-a48ff024c92d'::uuid,'Hall 7 Hostel','HOSTEL','Hall 7 postgraduate hostel, University of Benin Ugbowo Campus.',6.397970::numeric,5.625230::numeric,array['Hall 7']::text[],true),
  ('99189c22-3c1b-4d07-baf5-81a1544aa283'::uuid,'Clinical Hostel','HOSTEL','Clinical students hostel, University of Benin Ugbowo Campus.',6.394530::numeric,5.617190::numeric,array['Clinical Hall','Clinical Students Hostel']::text[],true),
  ('8918a6f0-c56a-432f-b8d1-0d6aed349b57'::uuid,'NDDC Hostel','HOSTEL','NDDC student hostel, University of Benin Ugbowo Campus.',6.394710::numeric,5.617890::numeric,array['NDDC Hall']::text[],true),
  ('3b0c31b8-0be6-52b1-a8f1-426284503985'::uuid,'Medical Hostel','HOSTEL','Medical students hostel near the clinical and Anatomy axis.',6.396050::numeric,5.618950::numeric,array['Medical Students Hostel','Medical Hall']::text[],false),
  ('c56d49e1-8bbb-54be-84e1-542ca9878e9f'::uuid,'Keystone Hostel','HOSTEL','Keystone student hostel, Ugbowo Campus.',6.398913::numeric,5.625328::numeric,array['Keystone Hall']::text[],true),
  ('71afeb51-76f0-5b06-a38f-c79390432a78'::uuid,'Intercontinental Hostel','HOSTEL','Intercontinental postgraduate hostel, Ugbowo Campus.',6.398000::numeric,5.624400::numeric,array['Intercontinental Hall','Intercontinental Bank PG Hall']::text[],false),
  ('427ff6b3-eaa0-54d9-b043-7658f5f3a00e'::uuid,'Erastus Akinbola Postgraduate Hostel','HOSTEL','Postgraduate residence hall on Ugbowo Campus.',6.397413::numeric,5.625328::numeric,array['Akinbola Hostel','Festus Akingbola','Postgraduate Hostel']::text[],true),
  ('f9d9e845-ec23-4ef6-90da-aa84a651a5d6'::uuid,'Food Court (Buka)','FOOD','Campus food court (Buka), University of Benin Ugbowo Campus.',6.395260::numeric,5.619070::numeric,array['Buka','Food Court']::text[],true),
  ('d5b2d262-6648-5253-93d8-989c2b0f759b'::uuid,'Helena Food','FOOD','Food spot near the student hostel and Buka axis.',6.395900::numeric,5.617600::numeric,array['Helena Food UNIBEN']::text[],false),
  ('8269011d-9152-59a9-a527-97440fd51cb8'::uuid,'Mat-Ice Restaurant','FOOD','Restaurant near the medical and hostel axis.',6.395800::numeric,5.620300::numeric,array['Mat Ice','Mat-Ice']::text[],false),
  ('637e5efe-cb1c-5826-9e46-f33bf805c87a'::uuid,'Swift Canteen','FOOD','Student canteen near Pharmacy and Buka.',6.395520::numeric,5.619800::numeric,array['Swift Canteen UNIBEN']::text[],false),
  ('36196663-907e-50ec-83ef-eed7cdc307bd'::uuid,'CERHI Cafe','FOOD','Cafe near the health sciences area.',6.395650::numeric,5.620750::numeric,array['CERHI Café','CERHI']::text[],false),
  ('95ea2f97-b0fb-5104-bec4-b942a477444e'::uuid,'Nescafe Lounge UNIBEN','FOOD','Cafe/lounge in the eastern academic area.',6.401431::numeric,5.621666::numeric,array['Nescafe Lounge','Nescafe UNIBEN']::text[],true),
  ('7589297a-ce88-5d7d-b020-d60a9fff4fc9'::uuid,'Home & Away Restaurant Ugbowo','FOOD','Restaurant on the Ugbowo campus axis.',6.396013::numeric,5.614172::numeric,array['Home and Away','Home & Away']::text[],true),
  ('31815e90-5b67-5589-9744-5fb5547481d4'::uuid,'UNIBEN Book Shop','SERVICE','University bookshop and student supplies.',6.402150::numeric,5.621350::numeric,array['Bookshop','UNIBEN Bookshop']::text[],false),
  ('2ac78f1e-e237-50d1-aab3-0d7396e26833'::uuid,'June 12 Shopping Complex','SERVICE','Student shopping complex in the Law/Hall 4 axis.',6.398700::numeric,5.621300::numeric,array['June 12','June 12 UNIBEN']::text[],false),
  ('3ffac6ab-3650-5d64-997a-c2864dfdf288'::uuid,'Hall 1 Bus Stop','TRANSPORT','Campus shuttle stop serving the student halls.',6.396900::numeric,5.618050::numeric,array['Hall 1 Bus stop','Hall One Bus Stop']::text[],false),
  ('e547742a-868a-5349-81a2-f05a81ab06c8'::uuid,'Hall 1 Car Park','SERVICE','Car park serving Hall 1 and nearby facilities.',6.396350::numeric,5.618250::numeric,array['Hall 1 Parking','Hall 1 Car Park']::text[],false),
  ('ca06a270-05c4-501e-959d-40532503699c'::uuid,'Medical Hostel Car Park','SERVICE','Parking area near Medical Hostel.',6.395820::numeric,5.618650::numeric,array['Medical Hostel Parking']::text[],false),
  ('d9da568f-74da-5dd7-8d73-e63905878062'::uuid,'Alumni Car Park','SERVICE','Parking area near the library and hostel axis.',6.395950::numeric,5.617050::numeric,array['Alumni Parking']::text[],false),
  ('bf0cc0d5-6a6e-52ce-bc46-2c87ed953c49'::uuid,'Biochemistry Parking Lot','SERVICE','Parking area near the Department of Biochemistry.',6.396100::numeric,5.615350::numeric,array['Biochemistry Car Park','Biochemistry Parking']::text[],false),
  ('65f3124d-3690-50a6-a01e-1a7afe90eec5'::uuid,'UNIBEN Sports Complex','SPORT','University sports complex.',6.399763::numeric,5.613578::numeric,array['Sports Complex','Stadium']::text[],true),
  ('2436a456-902d-57fb-8310-cf9b8f7d5946'::uuid,'Main Bowl','SPORT','Main sports bowl within the university sports complex.',6.399200::numeric,5.612950::numeric,array['UNIBEN Main Bowl','Main Stadium Bowl']::text[],false),
  ('95d8aa69-b4a7-53cf-9861-cf7b12831249'::uuid,'UNIBEN Indoor Sports Hall','SPORT','Indoor sports facility on Ugbowo Campus.',6.398350::numeric,5.612750::numeric,array['Indoor Sports Hall','Indoor Sport Hall']::text[],false),
  ('217ebcc6-f66f-51c5-a856-3271399d5549'::uuid,'UNIBEN Basketball Court','SPORT','Outdoor basketball court on Ugbowo Campus.',6.397690::numeric,5.610920::numeric,array['Basketball Court','Basketball']::text[],true),
  ('d4b11b3d-dcdc-5f79-a742-97309f67fd59'::uuid,'Handball Court','SPORT','Outdoor handball court in the sports area.',6.397350::numeric,5.611150::numeric,array['UNIBEN Handball Court']::text[],false),
  ('3be9b5a7-6f6d-55ae-8f84-e35daff58078'::uuid,'Lawn Tennis Court','SPORT','Lawn tennis court in the sports area.',6.397900::numeric,5.611650::numeric,array['Tennis Court','UNIBEN Lawn Tennis']::text[],false);

with
uniben as (
  select id
  from public.universities
  where lower(name) = 'university of benin' and deleted_at is null
  limit 1
),
campus as (
  select id, institution_id
  from public.institution_campuses
  where institution_id = (select id from uniben)
    and slug = 'ugbowo'
  limit 1
),
source as (
  select id
  from public.content_sources
  where university_id = (select id from uniben)
    and name = 'KampusOne UNIBEN Ugbowo map directory'
  limit 1
)
update public.campus_places place
set
  campus_id = campus.id,
  category = starter.category,
  description = starter.description,
  latitude = starter.latitude,
  longitude = starter.longitude,
  source_id = source.id,
  search_aliases = starter.aliases,
  verified_at = case
    when starter.verified then coalesce(place.verified_at, now())
    else place.verified_at
  end,
  status = 'PUBLISHED',
  updated_at = now()
from kampusone_uniben_ugbowo_seed starter, campus, source
where place.university_id = campus.institution_id
  and lower(place.name) = lower(starter.name)
  and (place.campus_id is null or place.campus_id = campus.id);

with
uniben as (
  select id
  from public.universities
  where lower(name) = 'university of benin' and deleted_at is null
  limit 1
),
campus as (
  select id, institution_id
  from public.institution_campuses
  where institution_id = (select id from uniben)
    and slug = 'ugbowo'
  limit 1
),
source as (
  select id
  from public.content_sources
  where university_id = (select id from uniben)
    and name = 'KampusOne UNIBEN Ugbowo map directory'
  limit 1
)
insert into public.campus_places(
  id, university_id, campus_id, name, category, description,
  latitude, longitude, source_id, search_aliases, verified_at, status
)
select
  starter.id, campus.institution_id, campus.id, starter.name, starter.category,
  starter.description, starter.latitude, starter.longitude, source.id,
  starter.aliases, case when starter.verified then now() else null end, 'PUBLISHED'
from kampusone_uniben_ugbowo_seed starter, campus, source
where not exists (
  select 1
  from public.campus_places existing
  where existing.university_id = campus.institution_id
    and lower(existing.name) = lower(starter.name)
    and (existing.campus_id is null or existing.campus_id = campus.id)
);

commit;
