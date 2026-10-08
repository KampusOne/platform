export type CampusStarterPlace = {
  id: string;
  name: string;
  category:
    | "ACADEMIC"
    | "SERVICE"
    | "TRANSPORT"
    | "HOSTEL"
    | "FOOD"
    | "HEALTH"
    | "SPORT";
  description: string;
  latitude: string;
  longitude: string;
  accessibility_notes: string | null;
  image_url: string | null;
  search_aliases: readonly string[];
  verified_at: string | null;
};

export type CampusStarterDirectory = {
  campus: {
    name: string;
    slug: string;
    latitude: string;
    longitude: string;
    map_style: "KAMPUSONE";
    status: "PUBLISHED";
  };
  places: readonly CampusStarterPlace[];
};

type RawStarterPlace = readonly [
  id: string,
  name: string,
  category: CampusStarterPlace["category"],
  description: string,
  latitude: string,
  longitude: string,
  aliases: readonly string[],
  verifiedAt: string | null,
];

// Generated from database/imports/uniben-map2-2026-10-06.json plus 2026-10-07 corrections and 2026-10-09 reference POIs.
const RAW_UNIBEN_UGBOWO_PLACES = [
  [
    "71329ef0-fcc7-5931-96f9-bf100342a72e",
    "1000 LT Faculty of Physical Sciences",
    "ACADEMIC",
    "Large lecture theatre serving Physical Sciences.",
    "6.401093",
    "5.61716",
    [
      "Physical Science 1000 LT",
      "1000LT",
      "1000LT Faculty of Physical Science"
    ],
    null
  ],
  [
    "3a88b097-ccc5-5083-8b7f-ae4899df995d",
    "Academic Planning Division",
    "SERVICE",
    "Campus landmark.",
    "6.395892",
    "5.611237",
    [
      "Academic planning division Student Affairs",
      "Academic Planning UNIBEN"
    ],
    null
  ],
  [
    "3bf41660-958c-581e-b290-86d0894a1214",
    "Academy of Management Nigeria",
    "ACADEMIC",
    "Campus landmark.",
    "6.399225",
    "5.617144",
    [
      "The Academy of Management Nigeria",
      "Academy of Mangement Nigeria"
    ],
    null
  ],
  [
    "d30719b3-7e67-544c-9cf0-c7c51f089da1",
    "Access Bank ATM UNIBEN",
    "SERVICE",
    "Campus landmark.",
    "6.404912",
    "5.621563",
    [
      "Access Bank ATM",
      "Access ATM UNIBEN"
    ],
    null
  ],
  [
    "cf8451aa-9630-5eec-a7e6-50d1cc00da29",
    "ACE Academy",
    "ACADEMIC",
    "Campus landmark.",
    "6.39419",
    "5.615398",
    [
      "ACE Academy UNIBEN"
    ],
    null
  ],
  [
    "77f80eb3-624b-580e-bcd1-de539938aab1",
    "Affordable Meal Hub",
    "FOOD",
    "Campus landmark.",
    "6.399246",
    "5.611052",
    [
      "affordablemealhub"
    ],
    null
  ],
  [
    "24387c80-2642-5a4c-b9d4-29006e7bf9e2",
    "All Saints Chapel",
    "SERVICE",
    "Christian worship centre on Ugbowo Campus.",
    "6.401042",
    "5.611847",
    [
      "All Saints Chapel UNIBEN",
      "All Saints’ Chapel University of Benin"
    ],
    null
  ],
  [
    "d9da568f-74da-5dd7-8d73-e63905878062",
    "Alumni Car Park",
    "SERVICE",
    "Parking area near the library and hostel axis.",
    "6.39595",
    "5.61705",
    [
      "Alumni Parking"
    ],
    null
  ],
  [
    "c3b9b0fc-00b8-537b-a417-a3989904a39e",
    "Back Gate",
    "TRANSPORT",
    "Secondary campus access point on the eastern/southern campus edge.",
    "6.3959",
    "5.6252",
    [
      "UNIBEN Back Gate"
    ],
    null
  ],
  [
    "59368a84-86d1-5c4f-81a8-bdd6ef111e85",
    "Basement Shopping Complex",
    "SERVICE",
    "Student shopping and service complex known as Basement.",
    "6.396638",
    "5.615109",
    [
      "Basement",
      "Students Complex"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "a48a00cb-00c0-5ea8-a660-28f431b63d42",
    "Biochemistry Animal House UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.392995",
    "5.613528",
    [
      "Biochemistry Animal House"
    ],
    null
  ],
  [
    "bf0cc0d5-6a6e-52ce-bc46-2c87ed953c49",
    "Biochemistry Parking Lot",
    "SERVICE",
    "Parking area near the Department of Biochemistry.",
    "6.3961",
    "5.61535",
    [
      "Biochemistry Car Park",
      "Biochemistry Parking"
    ],
    null
  ],
  [
    "63e1a25a-c6be-5386-b53d-aa4f0708db42",
    "Bursary Department",
    "SERVICE",
    "University bursary and finance services.",
    "6.3981",
    "5.61685",
    [
      "Bursary",
      "UNIBEN Bursary"
    ],
    null
  ],
  [
    "b446bddc-f6b7-5e4a-a6ef-6f96738a7759",
    "Central Administration",
    "SERVICE",
    "Central administration area on Ugbowo Campus.",
    "6.39945",
    "5.61265",
    [
      "Central Admin",
      "Administration Block",
      "Registry"
    ],
    null
  ],
  [
    "6ada12ab-8e39-5938-8a6c-83f4ba5083f5",
    "Central Research Laboratory",
    "ACADEMIC",
    "University of Benin Central Research Laboratory.",
    "6.404004",
    "5.619853",
    [
      "CRL",
      "Central Research Lab",
      "Central Research Laboratory UNIBEN"
    ],
    null
  ],
  [
    "9ce6c230-f7c3-526b-adbe-e819e81ec85b",
    "Centre for Entrepreneurship Development",
    "ACADEMIC",
    "University entrepreneurship teaching and development centre.",
    "6.40208",
    "5.62125",
    [
      "Entrepreneurship Centre",
      "CED"
    ],
    null
  ],
  [
    "038818e6-ed02-5716-9e52-68c9b0018a7c",
    "Centre for Research Innovation",
    "ACADEMIC",
    "Full name is cropped in the supplied image.",
    "6.403899",
    "5.619444",
    [
      "Centre for research innovation"
    ],
    null
  ],
  [
    "680a996b-b27f-5bda-b76e-9ea577cf9022",
    "Centre of Excellence in Geosciences and Petroleum Engineering",
    "ACADEMIC",
    "Geosciences and petroleum engineering centre.",
    "6.40185",
    "5.6235",
    [
      "Centre of Excellence in Geosciences",
      "Geosciences Centre"
    ],
    null
  ],
  [
    "36196663-907e-50ec-83ef-eed7cdc307bd",
    "CERHI Cafe",
    "FOOD",
    "Cafe near the health sciences area.",
    "6.39565",
    "5.62075",
    [
      "CERHI Café",
      "CERHI"
    ],
    null
  ],
  [
    "9935b5f2-391c-51a5-a139-79fdf496d5a9",
    "Cheniels Clothing",
    "SERVICE",
    "Campus landmark.",
    "6.404578",
    "5.624031",
    [
      "Cheniels clothing"
    ],
    null
  ],
  [
    "18ebf6f7-df12-5bef-90f8-d38eca492c49",
    "Children's Swimming Pool UNIBEN",
    "SPORT",
    "Campus landmark.",
    "6.398135",
    "5.610638",
    [
      "Children’s Swimming Pool",
      "Children Swimming Pool"
    ],
    null
  ],
  [
    "ba33bf89-60a9-4f3d-a659-cba5a0d42a94",
    "Clinical Hostel",
    "HOSTEL",
    "Clinical students hostel, University of Benin Ugbowo Campus.",
    "6.394523",
    "5.617185",
    [
      "Clinical Hall",
      "Clinical Students Hostel",
      "Uniben Clinical Hostel"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "c8a0429f-2dc9-5a17-9069-26cd21325ad4",
    "Clinical Hostel Male",
    "HOSTEL",
    "Campus landmark.",
    "6.394096",
    "5.617315",
    [
      "Clinic hostel male",
      "Male Clinical Hostel"
    ],
    null
  ],
  [
    "65fdfcdf-50c1-5f53-83ff-28d7558fc506",
    "Computer Science Department",
    "ACADEMIC",
    "Computer Science Department, Ugbowo Campus.",
    "6.401695",
    "5.61735",
    [
      "Computer Science",
      "Computer Science Department UNIBEN"
    ],
    null
  ],
  [
    "6d537bb8-5ce0-5cf9-9f75-3e6507388ee5",
    "Computer Village Technology",
    "SERVICE",
    "Campus landmark.",
    "6.39858",
    "5.620794",
    [
      "Computer Village",
      "Computer Village Technology"
    ],
    null
  ],
  [
    "1e4c87fa-4f12-5b4f-85d9-10d1d29af76f",
    "Crowns Collections",
    "SERVICE",
    "Campus landmark.",
    "6.400387",
    "5.60909",
    [
      "CrownsCollections"
    ],
    null
  ],
  [
    "a83ed4d5-d98d-551a-bfe0-ef60e3a1d362",
    "D Splendor Design",
    "SERVICE",
    "Campus landmark.",
    "6.406587",
    "5.62218",
    [
      "D splendor design"
    ],
    null
  ],
  [
    "5aeff0e1-9df2-5e13-8c3f-a3b5005a2c01",
    "Department of Biochemistry",
    "ACADEMIC",
    "Department of Biochemistry, Ugbowo Campus.",
    "6.39625",
    "5.61505",
    [
      "Biochemistry",
      "Department of Biochemistry UNIBEN"
    ],
    null
  ],
  [
    "3a19a50f-6dae-5f4e-a6fd-cac0d4df55e4",
    "Department of Chemical Engineering",
    "ACADEMIC",
    "Department of Chemical Engineering in the Engineering cluster.",
    "6.402611",
    "5.616366",
    [
      "Chemical Engineering",
      "Chem Eng"
    ],
    null
  ],
  [
    "305f525f-6fdb-5088-a7fd-ce8015d3c530",
    "Department of Linguistics Studies",
    "ACADEMIC",
    "Campus landmark.",
    "6.399615",
    "5.609272",
    [
      "Department Linguistics Studies",
      "Linguistics Studies"
    ],
    null
  ],
  [
    "e9191210-1ab4-521c-9070-cccb3af86417",
    "Department of Materials and Metallurgy",
    "ACADEMIC",
    "Campus landmark.",
    "6.402672",
    "5.617115",
    [
      "Materials and Metallurgy",
      "Metallurgical Engineering",
      "Materials Engineering"
    ],
    null
  ],
  [
    "b075ac39-6419-5289-8d41-e8b1efc385c4",
    "Department of Petroleum Engineering",
    "ACADEMIC",
    "Campus landmark.",
    "6.403337",
    "5.616899",
    [
      "Petroleum Engineering",
      "Petroleum Engineering UNIBEN"
    ],
    null
  ],
  [
    "d26bc35d-d633-5b79-96cd-8160ed6d9e92",
    "Department of Pharmacology UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.393587",
    "5.615005",
    [
      "Department of Pharmacology",
      "Pharmacology UBTH"
    ],
    null
  ],
  [
    "31df48a9-749e-5696-a757-d6e839bc1aae",
    "Divvys Design",
    "SERVICE",
    "Campus landmark.",
    "6.398056",
    "5.610562",
    [
      "Divvys Design"
    ],
    null
  ],
  [
    "46272219-70e7-502d-bdc6-7080d15d494f",
    "Dr. Aihanuwa Aghahowa ICAN Lecture Theatre",
    "ACADEMIC",
    "Campus landmark.",
    "6.400694",
    "5.617222",
    [
      "ICAN Lecture Theatre",
      "Aihanuwa Aghahowa",
      "ICAN LT"
    ],
    null
  ],
  [
    "6a96705f-809a-5276-85c8-20a9483704c6",
    "Ekosodin Gate Security Post",
    "SERVICE",
    "Security post at the Ekosodin-side campus access.",
    "6.406689",
    "5.622353",
    [
      "Ekosodin Gate",
      "Ekosodin Security Post",
      "security post",
      "Ekosodin gate security"
    ],
    null
  ],
  [
    "f380056d-e405-5257-a3ee-846329a7af33",
    "El Mazon Catering",
    "FOOD",
    "Campus landmark.",
    "6.396529",
    "5.619433",
    [
      "El Mazon",
      "ElMazon Catering"
    ],
    null
  ],
  [
    "175bb188-292f-5058-9500-016f43014378",
    "Engineering Old 1000 LT",
    "ACADEMIC",
    "Large lecture theatre in the Engineering area.",
    "6.402919",
    "5.615856",
    [
      "Old 1000 LT",
      "Engineering 1000 LT",
      "Engineering OLD 1000 LT"
    ],
    null
  ],
  [
    "427ff6b3-eaa0-54d9-b043-7658f5f3a00e",
    "Erastus Akinbola Postgraduate Hostel",
    "HOSTEL",
    "Postgraduate residence hall on Ugbowo Campus.",
    "6.397439",
    "5.6253",
    [
      "Akinbola Hostel",
      "Festus Akingbola",
      "Postgraduate Hostel"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "1f04e0be-c0d8-5477-8992-7cdd5d7f75d5",
    "Eros Laundromat",
    "SERVICE",
    "Campus landmark.",
    "6.399403",
    "5.6216",
    [
      "Eros Laundry"
    ],
    null
  ],
  [
    "816b8a58-2a5c-55ae-b3c6-7f98b60f60f9",
    "Esthy Cakes N' More",
    "FOOD",
    "Campus landmark.",
    "6.399764",
    "5.609461",
    [
      "Esthy Cakes N’More",
      "Esthy Cakes"
    ],
    null
  ],
  [
    "2be8a76a-ef9f-5a69-a3cc-3abbd5803bae",
    "Exams and Records",
    "SERVICE",
    "Examinations and records office area.",
    "6.399",
    "5.6121",
    [
      "Exams & Records",
      "Records Office"
    ],
    null
  ],
  [
    "25931066-ecde-5af0-89c0-ef9a84a30343",
    "Faculty of Agriculture Shopping Mall",
    "SERVICE",
    "Student shopping area serving the Agriculture and Hall 4 axis.",
    "6.397799",
    "5.621642",
    [
      "Agric Shopping Mall",
      "Agriculture Shopping",
      "Faculty of Agriculture Shopping mall",
      "Agriculture Shopping Mall"
    ],
    null
  ],
  [
    "60cfd3e2-6db6-581a-9048-76b057103a11",
    "Faculty of Arts",
    "ACADEMIC",
    "Faculty of Arts, University of Benin Ugbowo Campus.",
    "6.4033",
    "5.62217",
    [
      "Arts",
      "Faculty Arts"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "23e74882-cc36-4597-8f51-c7b0525c7a59",
    "Faculty of Education",
    "ACADEMIC",
    "Faculty of Education, University of Benin Ugbowo Campus.",
    "6.400946",
    "5.619759",
    [
      "Education",
      "Education UNIBEN"
    ],
    null
  ],
  [
    "ecf0afdb-b248-51be-8a60-8d23b58be0c2",
    "Faculty of Education Car Park",
    "TRANSPORT",
    "Campus landmark.",
    "6.401465",
    "5.619943",
    [
      "Education Car Park"
    ],
    null
  ],
  [
    "34d8539c-a0b8-4651-917b-f4617433c48d",
    "Faculty of Engineering",
    "ACADEMIC",
    "Faculty of Engineering, University of Benin Ugbowo Campus.",
    "6.40179",
    "5.61537",
    [
      "Engineering",
      "Engr"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "c3928d61-f327-557e-a243-b5c3ae7bec19",
    "Faculty of Environmental Sciences",
    "ACADEMIC",
    "Faculty of Environmental Sciences campus building.",
    "6.4028",
    "5.62065",
    [
      "Environmental Science",
      "Environmental Sciences"
    ],
    null
  ],
  [
    "b62fe3ce-a261-4db2-86f3-f6dc0a7b2d14",
    "Faculty of Law",
    "ACADEMIC",
    "Faculty of Law, University of Benin Ugbowo Campus.",
    "6.40053",
    "5.62244",
    [
      "Law"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "ef4f3b54-51d4-4ba3-88fe-c07bdcc2868f",
    "Faculty of Life Sciences",
    "ACADEMIC",
    "Faculty of Life Sciences, University of Benin Ugbowo Campus.",
    "6.39894",
    "5.61487",
    [
      "Life Science",
      "Life Sciences"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "6a656590-974f-5ac8-ba5b-6a660e4ddf8d",
    "Faculty of Life Sciences Dean's Office",
    "ACADEMIC",
    "Dean's Office for the Faculty of Life Sciences.",
    "6.39862",
    "5.61565",
    [
      "Life Science Dean Office",
      "Dean's Office Life Science"
    ],
    null
  ],
  [
    "9ee9eac7-eeee-5da5-bc97-a0cb34f4b9b5",
    "Faculty of Management Sciences",
    "ACADEMIC",
    "Faculty of Management Sciences building.",
    "6.399196",
    "5.617897",
    [
      "Management Sciences",
      "Management Science"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "eb6b62e3-7ccc-5739-a727-bddccc0f70df",
    "Faculty of Pharmacy",
    "ACADEMIC",
    "Faculty of Pharmacy, Ugbowo Campus.",
    "6.39605",
    "5.62035",
    [
      "Pharmacy",
      "Faculty Pharmacy"
    ],
    null
  ],
  [
    "21f25ffb-136a-4f64-9319-56725cff3177",
    "Faculty of Physical Sciences",
    "ACADEMIC",
    "Faculty of Physical Sciences, University of Benin Ugbowo Campus.",
    "6.40031",
    "5.61535",
    [
      "Physical Science",
      "Physical Sciences"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "44e48498-d4d7-55cd-834c-9785cec9f112",
    "FagCoop Restaurant",
    "FOOD",
    "Campus landmark.",
    "6.399881",
    "5.621488",
    [
      "Fag Coop Restaurant",
      "FagCoop"
    ],
    null
  ],
  [
    "f75b3456-471d-55c0-b64d-63b4a885086e",
    "Festus Iyayi Hall",
    "ACADEMIC",
    "Large lecture and event hall in the central academic area.",
    "6.398438",
    "5.617391",
    [
      "Festus Iyayi Hall",
      "Iyayi Hall",
      "FESTUS IYAYI HALL"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "14f1dac4-c7d7-5551-bbe7-8885441d4779",
    "Fex Grillx and Chopx",
    "FOOD",
    "Campus landmark.",
    "6.393156",
    "5.615159",
    [
      "Fex Grillx & Chopx",
      "Fex Grillx"
    ],
    null
  ],
  [
    "ed6428c9-1102-5cd6-9631-db9ec91dbc2e",
    "Fidelity Bank - UNIBEN",
    "SERVICE",
    "Fidelity Bank branch on Ugbowo Campus.",
    "6.402208",
    "5.61056",
    [
      "Fidelity Bank",
      "Fidelity UNIBEN"
    ],
    null
  ],
  [
    "8325299e-536a-56a5-9385-1eb8160d8060",
    "Finetech Gadget and Phone Repair",
    "SERVICE",
    "Campus landmark.",
    "6.398824",
    "5.60948",
    [
      "Finetech Gadget & Phone Repair",
      "Finetech"
    ],
    null
  ],
  [
    "84973da3-033f-5192-9bc6-f76ff76d428c",
    "First Bank - UNIBEN",
    "SERVICE",
    "First Bank branch on Ugbowo Campus.",
    "6.402121",
    "5.610323",
    [
      "First Bank",
      "FirstBank UNIBEN"
    ],
    null
  ],
  [
    "55b53683-7b28-46be-b977-48e5f0773365",
    "Food Court (Buka)",
    "FOOD",
    "Campus food court (Buka), University of Benin Ugbowo Campus.",
    "6.395247",
    "5.619069",
    [
      "Buka",
      "Food Court",
      "Food Court Buka UNIBEN"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "4650f2ab-e7ae-5abb-9679-d45417deb991",
    "Foursquare Students' Fellowship UNIBEN",
    "SERVICE",
    "Campus landmark.",
    "6.39646",
    "5.611227",
    [
      "Foursquare Students’ Fellowship",
      "Foursquare Students Fellowship"
    ],
    null
  ],
  [
    "a0736a2d-4366-54f6-92ce-513c1855f280",
    "Frame Dynasty",
    "SERVICE",
    "Campus landmark.",
    "6.399269",
    "5.610086",
    [
      "Frame Dynasty UNIBEN"
    ],
    null
  ],
  [
    "cd72e27b-d71f-5459-9850-ef60b8fddcf0",
    "Gladtidings Data",
    "SERVICE",
    "Campus landmark.",
    "6.401324",
    "5.620367",
    [
      "gladtidings data"
    ],
    null
  ],
  [
    "74582de7-7afc-5f11-a60b-3c7568603848",
    "Gracevine Chapel",
    "SERVICE",
    "Campus landmark.",
    "6.3981",
    "5.62114",
    [
      "Gracevine Chapel UNIBEN"
    ],
    null
  ],
  [
    "c503e423-4b99-5e36-bf3c-dec9ca03406a",
    "Guaranty Trust Bank - UNIBEN",
    "SERVICE",
    "Guaranty Trust Bank campus branch.",
    "6.402486",
    "5.61011",
    [
      "GTBank",
      "GTB UNIBEN",
      "Guaranty Trust Bank",
      "GTB"
    ],
    null
  ],
  [
    "e4771cda-dbfe-50ae-a779-d26e5d956f98",
    "Gypsy Car Polishing and Buffing Service",
    "SERVICE",
    "Campus landmark.",
    "6.396889",
    "5.61163",
    [
      "Gypsy Car Polishing And Buffing Service"
    ],
    null
  ],
  [
    "3ffac6ab-3650-5d64-997a-c2864dfdf288",
    "Hall 1 Bus Stop",
    "TRANSPORT",
    "Campus shuttle stop serving the student halls.",
    "6.397717",
    "5.618352",
    [
      "Hall 1 Bus stop",
      "Hall One Bus Stop"
    ],
    null
  ],
  [
    "e547742a-868a-5349-81a2-f05a81ab06c8",
    "Hall 1 Car Park",
    "SERVICE",
    "Car park serving Hall 1 and nearby facilities.",
    "6.3972",
    "5.619232",
    [
      "Hall 1 Parking",
      "Hall 1 Car Park",
      "Hall 1 parking"
    ],
    null
  ],
  [
    "9ca0be2a-0ea6-5305-bebf-7b4315e6c1ad",
    "Hall 1 Hostel",
    "HOSTEL",
    "Hall 1 (Queen Idia Hall), Ugbowo Campus.",
    "6.396673",
    "5.618657",
    [
      "Hall 1",
      "Queen Idia Hostel",
      "Queen Idia Hall",
      "Hall 1 Queen Idia Hostel"
    ],
    null
  ],
  [
    "5f533056-4827-575d-a43c-4a5a3cfa4cfe",
    "Hall 2 Car Park",
    "TRANSPORT",
    "Campus landmark.",
    "6.397527",
    "5.61956",
    [
      "Hall 2 parking"
    ],
    null
  ],
  [
    "1e1ddc99-6b48-585c-8df5-fe25b9177045",
    "Hall 2 Hostel",
    "HOSTEL",
    "Hall 2 (Madam Tinubu Hall), Ugbowo Campus.",
    "6.398438",
    "5.619672",
    [
      "Hall 2",
      "Tinubu Female Hostel",
      "Madam Tinubu Hall"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "4f739e6a-b37a-53c6-91fa-5b20efb1273b",
    "Hall 2 Love Garden",
    "SERVICE",
    "Campus landmark.",
    "6.397913",
    "5.619288",
    [
      "Hall 2 love garden",
      "Love Garden"
    ],
    null
  ],
  [
    "95de09db-4898-589a-8496-4a3814294d66",
    "Hall 3 Hostel",
    "HOSTEL",
    "Hall 3 (Mallam Aminu Kano Hall), Ugbowo Campus.",
    "6.396913",
    "5.619953",
    [
      "Hall 3",
      "Aminu Kano Hostel",
      "Mallam Aminu Kano Hall"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "bc5f982b-7509-566e-b62f-29fc7362175c",
    "Hall 4 Hostel",
    "HOSTEL",
    "Hall 4 (Akanu Ibiam Hall), Ugbowo Campus.",
    "6.3983",
    "5.62255",
    [
      "Hall 4",
      "Akanu Ibiam Hall"
    ],
    null
  ],
  [
    "b077fc66-4cf6-4bff-93ed-61620455aa10",
    "Hall 5 Hostel",
    "HOSTEL",
    "Hall 5 student hostel, University of Benin Ugbowo Campus.",
    "6.397116",
    "5.623923",
    [
      "Hall 5"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "883d8a9e-5f65-4960-8274-a193f5a4eea8",
    "Hall 6 Hostel",
    "HOSTEL",
    "Hall 6 student hostel, University of Benin Ugbowo Campus.",
    "6.398215",
    "5.626191",
    [
      "Hall 6"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "7f6a6a83-c01b-48d0-bdce-7a126b9491b8",
    "Hall 7 Hostel",
    "HOSTEL",
    "Hall 7 postgraduate hostel, University of Benin Ugbowo Campus.",
    "6.397968",
    "5.625226",
    [
      "Hall 7"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "d4b11b3d-dcdc-5f79-a742-97309f67fd59",
    "Handball Court",
    "SPORT",
    "Outdoor handball court in the sports area.",
    "6.396766",
    "5.610794",
    [
      "UNIBEN Handball Court",
      "Uniben Handball Court"
    ],
    null
  ],
  [
    "d5b2d262-6648-5253-93d8-989c2b0f759b",
    "Helena Food",
    "FOOD",
    "Food spot near the student hostel and Buka axis.",
    "6.396139",
    "5.618962",
    [
      "Helena Food UNIBEN",
      "Helena Fast Food"
    ],
    null
  ],
  [
    "7589297a-ce88-5d7d-b020-d60a9fff4fc9",
    "Home & Away Restaurant Ugbowo",
    "FOOD",
    "Restaurant on the Ugbowo campus axis.",
    "6.396013",
    "5.614172",
    [
      "Home and Away",
      "Home & Away"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "7dddb9ff-df5d-5c1d-bd25-affb0df6ce11",
    "Institute of Health Sciences and Technology",
    "ACADEMIC",
    "Health sciences and technology institute near the Main Gate axis.",
    "6.395034",
    "5.613075",
    [
      "Institute of Health Sciences",
      "Health Sciences and Technology",
      "Institute of Health Sciences and Technology UBTH",
      "IHST UBTH"
    ],
    null
  ],
  [
    "7c057ca2-ddf6-5a25-95d1-2ed0fb8309aa",
    "Institute of Human Virology UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.392156",
    "5.613457",
    [
      "Institute of Human Virology",
      "IHV UBTH"
    ],
    null
  ],
  [
    "71afeb51-76f0-5b06-a38f-c79390432a78",
    "Intercontinental Hostel",
    "HOSTEL",
    "Intercontinental postgraduate hostel, Ugbowo Campus.",
    "6.397993",
    "5.624648",
    [
      "Intercontinental Hall",
      "Intercontinental Bank PG Hall"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "c69db02d-4c0e-549d-a197-0700b5648f05",
    "J Relish and Events",
    "FOOD",
    "Campus landmark.",
    "6.399628",
    "5.609779",
    [
      "J Relish & Events"
    ],
    null
  ],
  [
    "6d0910e1-8930-55d0-a5e7-ca565b1fbce6",
    "Joasi Motors Nig",
    "SERVICE",
    "Campus landmark.",
    "6.392494",
    "5.613981",
    [
      "Joasi Motors Nigeria"
    ],
    null
  ],
  [
    "1a926f1d-222c-581a-80a0-b1d6042e4867",
    "John Harris Library",
    "ACADEMIC",
    "Main academic library on Ugbowo Campus.",
    "6.39666",
    "5.616687",
    [
      "JHL",
      "Main Library",
      "John Harris"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "3c9fcb8e-39ff-51f1-a796-07126e17decb",
    "John Harris Library Extension",
    "ACADEMIC",
    "John Harris Library extension and e-learning spaces.",
    "6.39693",
    "5.61652",
    [
      "Library Extension",
      "Donald Partridge e-Learning Centre",
      "MTNF e-Library"
    ],
    null
  ],
  [
    "2ac78f1e-e237-50d1-aab3-0d7396e26833",
    "June 12 Shopping Complex",
    "SERVICE",
    "Student shopping complex in the Law/Hall 4 axis.",
    "6.398974",
    "5.621411",
    [
      "June 12",
      "June 12 UNIBEN",
      "June 12 UNIBEN Shopping Mall"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "876a321c-bb71-47d4-a1ea-390764b5f575",
    "JUPEB Foundation School",
    "ACADEMIC",
    "UNIBEN JUPEB Foundation School, Ugbowo Campus.",
    "6.397003",
    "5.617815",
    [
      "JUPEB",
      "Foundation School",
      "JUPEB Building"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "20be58ed-ddeb-5569-9a3b-5696fc95d529",
    "KC Cars",
    "SERVICE",
    "Campus landmark.",
    "6.39683",
    "5.610946",
    [
      "Kc Cars"
    ],
    null
  ],
  [
    "c56d49e1-8bbb-54be-84e1-542ca9878e9f",
    "Keystone Hostel",
    "HOSTEL",
    "Keystone student hostel, Ugbowo Campus.",
    "6.398984",
    "5.62532",
    [
      "Keystone Hall"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "00599d62-2fa0-531d-898d-0056f3610e2e",
    "KOFA X",
    "SERVICE",
    "Campus landmark.",
    "6.398836",
    "5.610088",
    [
      "KOFA X UNIBEN"
    ],
    null
  ],
  [
    "e77357ac-b13b-5a5f-ba7a-42a7140f9494",
    "Laptek Solutions",
    "SERVICE",
    "Campus landmark.",
    "6.398354",
    "5.62094",
    [
      "Lapteksolutions",
      "Laptek"
    ],
    null
  ],
  [
    "3be9b5a7-6f6d-55ae-8f84-e35daff58078",
    "Lawn Tennis Court",
    "SPORT",
    "Lawn tennis court in the sports area.",
    "6.397318",
    "5.610703",
    [
      "Tennis Court",
      "UNIBEN Lawn Tennis",
      "UNIBEN Tennis Court"
    ],
    null
  ],
  [
    "34ae9089-799b-5cb9-8ddc-5026d572faea",
    "Life Science Shopping Complex",
    "SERVICE",
    "Student shopping and food services near Life Sciences.",
    "6.397238",
    "5.615359",
    [
      "Life Science Shops",
      "Life Science Shopping"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "5d2dbd85-bbb3-5564-93f2-54f65ec38e8c",
    "Life Vitality GNLD Supplement",
    "SERVICE",
    "Campus landmark.",
    "6.402276",
    "5.612113",
    [
      "Life Vitality GNLD Supplement",
      "GNLD Supplements"
    ],
    null
  ],
  [
    "6f07fb4c-6cd0-5967-bba8-840d74fdf2a3",
    "Litas Hub",
    "SERVICE",
    "Campus landmark.",
    "6.399151",
    "5.609744",
    [
      "LitasHub"
    ],
    null
  ],
  [
    "436a695c-31c8-5558-aa61-9004d3e195cd",
    "LiviCutx Mobile Barbering Services",
    "SERVICE",
    "Campus landmark.",
    "6.399281",
    "5.619888",
    [
      "LiviCutx",
      "LiviCutx Mobile Babering services"
    ],
    null
  ],
  [
    "86c0da55-8608-566d-9c53-5c11fc582c6f",
    "Liz Photo Studio",
    "SERVICE",
    "Campus landmark.",
    "6.400585",
    "5.609676",
    [
      "Liz Photo Studio UNIBEN"
    ],
    null
  ],
  [
    "9f040cce-eb71-572a-8dd8-15cbe7799b19",
    "Main Auditorium",
    "SERVICE",
    "University of Benin Main Auditorium.",
    "6.39971",
    "5.6133",
    [
      "UNIBEN Main Auditorium",
      "Auditorium"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "2436a456-902d-57fb-8310-cf9b8f7d5946",
    "Main Bowl",
    "SPORT",
    "Main sports bowl within the university sports complex.",
    "6.3992",
    "5.61295",
    [
      "UNIBEN Main Bowl",
      "Main Stadium Bowl"
    ],
    null
  ],
  [
    "280c87f4-139b-5504-ac0c-f910731ac64c",
    "Main Gate",
    "TRANSPORT",
    "Primary Ugbowo campus entrance and student pickup landmark.",
    "6.39992",
    "5.60887",
    [
      "UNIBEN Main Gate",
      "Main Entrance"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "7a85539d-13df-5d11-8c95-4cc878ef0657",
    "Main Gate Bus Terminal",
    "TRANSPORT",
    "Campus bus and shuttle pickup area near the Main Gate.",
    "6.398646",
    "5.609915",
    [
      "Maingate Bus Terminal",
      "Main Gate Bus Stop",
      "Public Transport",
      "Main Gate Public Transport"
    ],
    null
  ],
  [
    "dfb816ff-345c-5af0-80bc-0383f2c09fca",
    "Maingate Shopping Complex",
    "SERVICE",
    "Student shopping and services complex near the Main Gate.",
    "6.398269",
    "5.610064",
    [
      "Main Gate Shopping Complex",
      "Maingate Shops",
      "Maingate Shopping Complex UNIBEN"
    ],
    null
  ],
  [
    "8269011d-9152-59a9-a527-97440fd51cb8",
    "Mat-Ice Restaurant",
    "FOOD",
    "Restaurant near the medical and hostel axis.",
    "6.3958",
    "5.6203",
    [
      "Mat Ice",
      "Mat-Ice"
    ],
    null
  ],
  [
    "e5b0f8af-acb2-505b-ac88-000ef4acc477",
    "Mechanical Production Laboratory",
    "ACADEMIC",
    "Mechanical Production laboratory in the Engineering cluster.",
    "6.40193",
    "5.616236",
    [
      "Mechanical Production Lab",
      "Mechanical Lab"
    ],
    null
  ],
  [
    "25f63f0f-4524-590c-9ac0-6fbe0b56a8ab",
    "Medical Complex",
    "HEALTH",
    "Medical teaching and service complex on Ugbowo Campus.",
    "6.395478",
    "5.6235",
    [
      "Medical Complex UNIBEN"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "3b0c31b8-0be6-52b1-a8f1-426284503985",
    "Medical Hostel",
    "HOSTEL",
    "Medical students hostel near the clinical and Anatomy axis.",
    "6.394394",
    "5.616289",
    [
      "Medical Students Hostel",
      "Medical Hall",
      "Medical Hostel UNIBEN"
    ],
    null
  ],
  [
    "ca06a270-05c4-501e-959d-40532503699c",
    "Medical Hostel Car Park",
    "SERVICE",
    "Parking area near Medical Hostel.",
    "6.39483",
    "5.615532",
    [
      "Medical Hostel Parking",
      "Medical Hostel parking"
    ],
    null
  ],
  [
    "44de0bed-f5d1-4c89-a8f7-1e0a74081aeb",
    "NDDC Hostel",
    "HOSTEL",
    "NDDC student hostel, University of Benin Ugbowo Campus.",
    "6.394694",
    "5.617904",
    [
      "NDDC Hall",
      "NDDC Hostel UNIBEN"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "95ea2f97-b0fb-5104-bec4-b942a477444e",
    "Nescafe Lounge UNIBEN",
    "FOOD",
    "Cafe/lounge in the eastern academic area.",
    "6.401431",
    "5.621666",
    [
      "Nescafe Lounge",
      "Nescafe UNIBEN"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "d345d3fc-8c25-5a23-88d7-22b34b4d4376",
    "New Faculty of Agriculture",
    "ACADEMIC",
    "New Faculty of Agriculture building.",
    "6.402136",
    "5.62355",
    [
      "New Agric",
      "Agriculture",
      "New Faculty of Agriculture UNIBEN",
      "New Agriculture"
    ],
    null
  ],
  [
    "e8e6cc3d-3e8b-5aac-a2a1-17d651c04d4e",
    "Nije Web Service",
    "SERVICE",
    "Campus landmark.",
    "6.401792",
    "5.611063",
    [
      "Nije web service"
    ],
    null
  ],
  [
    "bdac2bf3-c1b9-5bec-85a0-e64a617ac0b5",
    "Nurses' Hostel Complex UBTH",
    "HOSTEL",
    "Nearby hospital teaching/service location.",
    "6.393121",
    "5.615766",
    [
      "Nurses’ Hostel Complex UBTH",
      "Nurses Hostel",
      "Nurses' Hostel Complex University of Benin Teaching Hospital"
    ],
    null
  ],
  [
    "bdf17e94-d252-5e01-b9ab-a3a51fdaae51",
    "Oba Akenzua Complex UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.393058",
    "5.613085",
    [
      "Oba Akenzua Complex",
      "Oba Akenzua II Complex"
    ],
    null
  ],
  [
    "67e26f4b-9277-559b-ba2b-aaa54fe9de10",
    "Ogab Shoe Spa",
    "SERVICE",
    "Campus landmark.",
    "6.406614",
    "5.6209",
    [
      "Ogab Shoe Spa"
    ],
    null
  ],
  [
    "e3c770cc-6839-5f57-a233-93882ffa36ee",
    "OK Bar and Lounge",
    "FOOD",
    "Campus landmark.",
    "6.400501",
    "5.609796",
    [
      "OK Bar & Lounge"
    ],
    null
  ],
  [
    "338d121f-da2a-5d76-8a41-fcd266804cb4",
    "Old Faculty of Agriculture",
    "ACADEMIC",
    "Older Faculty of Agriculture building east of the Law area.",
    "6.400252",
    "5.62338",
    [
      "Old Agric",
      "Old Agriculture"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "5f86a789-de5a-4983-a4e7-175e01941a11",
    "Opolo Innovation Hub",
    "ACADEMIC",
    "Opolo Hub at UNIBEN Ugbowo, behind the Faculty of Education. This approximate venue pin is sourced from the Filecoin campus event listing at https://luma.com/3321kofo (Google place ChIJNV3NOEstRxARIlQY8AsN_C8). The precise entrance still needs campus verification.",
    "6.400757",
    "5.620862",
    [
      "Opolo Hub",
      "Opolo",
      "Innovation Hub"
    ],
    null
  ],
  [
    "724a8afe-20bb-56ce-987c-191ec01a7f03",
    "PBB and AEB Laboratories",
    "ACADEMIC",
    "Life Sciences PBB, MCB and AEB laboratory cluster.",
    "6.39816",
    "5.616",
    [
      "PBB Labs",
      "AEB Labs",
      "MCB",
      "Faculty of Life Science Labs"
    ],
    null
  ],
  [
    "886362e8-0aae-5388-9579-d03a7d177a46",
    "Petroleum and Energy Research Centre",
    "ACADEMIC",
    "Petroleum and energy research centre.",
    "6.40457",
    "5.620566",
    [
      "Petroleum Research Centre",
      "Energy Research Centre",
      "Petroleum and Energy System Research Centre",
      "PESRC"
    ],
    null
  ],
  [
    "bb931009-6d8b-5647-88ec-3603b720f8d9",
    "Pharmacy Annex",
    "ACADEMIC",
    "Pharmacy teaching annex near the medical and hostel axis.",
    "6.3957",
    "5.62022",
    [
      "Pharmacy Annex UNIBEN"
    ],
    null
  ],
  [
    "fd9c8337-c8ce-593b-a3f0-616c261d5d32",
    "Pharmacy Lecture Theatres",
    "ACADEMIC",
    "Lecture theatre cluster serving Pharmacy.",
    "6.39618",
    "5.6199",
    [
      "Pharmacy LT",
      "Pharmacy Lecture Theater"
    ],
    null
  ],
  [
    "9bca53e1-9717-5df7-83bd-1f94e55eccc9",
    "Physical Planning Division",
    "SERVICE",
    "Campus landmark.",
    "6.396125",
    "5.611769",
    [
      "Physical Planning Division University of Benin",
      "Physical Planning UNIBEN"
    ],
    null
  ],
  [
    "55e0eb48-41a4-5c0f-8d6d-249f301c185c",
    "Physical Science Department UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.393088",
    "5.614459",
    [
      "Physical Science Department UBTH"
    ],
    null
  ],
  [
    "eb15b248-b922-50a8-a532-4d734a480f2a",
    "Physical Science Shopping Complex",
    "SERVICE",
    "Student food, stationery and everyday services near Physical Sciences.",
    "6.39954",
    "5.616614",
    [
      "Physical Science Shops",
      "Physical Science Shopping"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "c76628f7-4998-5c9c-a878-f856f7ed8c26",
    "Riri's Haven",
    "SERVICE",
    "Campus landmark.",
    "6.400284",
    "5.609063",
    [
      "Riri’s Haven"
    ],
    null
  ],
  [
    "4bfd8bd4-a74c-5d15-84c5-1e20049eaa96",
    "Rodelenz Industries",
    "SERVICE",
    "Campus landmark.",
    "6.400159",
    "5.609889",
    [
      "Rodelenz Industries"
    ],
    null
  ],
  [
    "699b8863-aa06-5c36-b2ee-341851572767",
    "ROOOM XIX Benin City",
    "SERVICE",
    "Campus landmark.",
    "6.398878",
    "5.621193",
    [
      "ROOOM XIX",
      "Room XIX"
    ],
    null
  ],
  [
    "f15c6991-120f-5afb-9c52-723cb03585bc",
    "Sanctus Collections",
    "SERVICE",
    "Campus landmark.",
    "6.405807",
    "5.62142",
    [
      "SANCTUS COLLECTIONS"
    ],
    null
  ],
  [
    "b6476973-c5db-5d17-9464-25dae56e6774",
    "School of Dentistry",
    "ACADEMIC",
    "School of Dentistry, University of Benin.",
    "6.396372",
    "5.624711",
    [
      "Dentistry",
      "School Of Dentistry"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "93dc6d05-909d-5465-a7bb-940c101fc717",
    "School of Dentistry UBTH Site",
    "ACADEMIC",
    "Hospital teaching site; the main-campus Dentistry building remains a separate entry.",
    "6.392701",
    "5.613184",
    [
      "School of Dentistry UBTH",
      "UBTH Dentistry"
    ],
    null
  ],
  [
    "450a1c9a-65be-566f-8aea-86bcf961f5e3",
    "School of Post-Basic Nursing Studies UBTH",
    "ACADEMIC",
    "Nearby hospital teaching/service location.",
    "6.392764",
    "5.614673",
    [
      "School of Post-Basic Nursing Studies",
      "Post Basic Nursing UBTH"
    ],
    null
  ],
  [
    "b9f0fde1-3046-597d-9f6d-620f64ae3e59",
    "Senior Staff Quarters UNIBEN",
    "SERVICE",
    "Campus landmark.",
    "6.405592",
    "5.620781",
    [
      "Senior Staff Quarters",
      "Staff Quarters UNIBEN"
    ],
    null
  ],
  [
    "653d2521-cd3b-5388-85f5-f64624d16e5c",
    "ShawarmaCreed (Karizos Lounge)",
    "FOOD",
    "Campus landmark.",
    "6.39845",
    "5.619688",
    [
      "shawarmaCreed",
      "KarizosLounge",
      "Karizos Lounge"
    ],
    null
  ],
  [
    "6eb7ff0e-2a61-558d-b5b4-4915dfd392fa",
    "Shopping Zone",
    "SERVICE",
    "Campus landmark.",
    "6.398939",
    "5.610078",
    [
      "Shopping Zone UNIBEN"
    ],
    null
  ],
  [
    "58d592dc-3807-5734-beb0-9fdcef25d4ac",
    "Spago'clock",
    "FOOD",
    "Campus landmark.",
    "6.401617",
    "5.6101",
    [
      "Spago’clock",
      "Spago clock"
    ],
    null
  ],
  [
    "20be3e9f-67e0-5fe8-989e-4ef0f4ff197e",
    "St. Albert Catholic Church",
    "SERVICE",
    "Catholic worship centre on Ugbowo Campus.",
    "6.401612",
    "5.611814",
    [
      "Saint Albert Catholic Church",
      "St Albert",
      "St. Albert Catholic Church UNIBEN",
      "St Albert Catholic Church"
    ],
    null
  ],
  [
    "15a9767e-a1d4-5e90-8af4-a3e15d6f6c4e",
    "St. Albert's Lodge UNIBEN",
    "HOSTEL",
    "Campus landmark.",
    "6.401377",
    "5.611222",
    [
      "St. Albert’s Lodge UNIBEN",
      "St Albert Lodge"
    ],
    null
  ],
  [
    "7fe547f4-1a71-53f0-b674-4c545b41d3c2",
    "Stanbic IBTC Bank - UNIBEN",
    "SERVICE",
    "Stanbic IBTC branch on Ugbowo Campus.",
    "6.402311",
    "5.61039",
    [
      "Stanbic IBTC",
      "Stanbic UNIBEN"
    ],
    null
  ],
  [
    "42576a72-aa7e-429e-8853-430c4e82524c",
    "Student Affairs Division",
    "SERVICE",
    "Student Affairs Division, University of Benin Ugbowo Campus.",
    "6.400023",
    "5.609885",
    [
      "Student Affairs",
      "Dean of Students"
    ],
    "2026-10-01T03:35:18.691105+00:00"
  ],
  [
    "52ecce2e-8dac-5b0f-92d6-212536be74a6",
    "Student Guidance and Counselling Centre",
    "SERVICE",
    "Student Guidance and Counselling Centre near the old bookshop and student halls.",
    "6.39675",
    "5.61918",
    [
      "Guidance and Counselling",
      "Counselling Centre"
    ],
    null
  ],
  [
    "637e5efe-cb1c-5826-9e46-f33bf805c87a",
    "Swift Canteen",
    "FOOD",
    "Student canteen near Pharmacy and Buka.",
    "6.395461",
    "5.619223",
    [
      "Swift Canteen UNIBEN"
    ],
    null
  ],
  [
    "cf74acfb-d290-5368-afbd-1997b6a1afa4",
    "Tee Beauty Glamour",
    "SERVICE",
    "Campus landmark.",
    "6.399464",
    "5.60915",
    [
      "TeeBeautyGlamour"
    ],
    null
  ],
  [
    "39493ddf-fdae-5a8b-84cf-5a44f88de76f",
    "The Food Faculty",
    "FOOD",
    "Campus landmark.",
    "6.396615",
    "5.619586",
    [
      "Food Faculty"
    ],
    null
  ],
  [
    "db06d014-2dd6-537e-aa3a-75aae1587871",
    "The Institution of Light",
    "SERVICE",
    "Campus landmark.",
    "6.399828",
    "5.609026",
    [
      "The Institution of Light"
    ],
    null
  ],
  [
    "10e409a2-126b-5815-912b-65c3e591e10b",
    "TS Beauty Accessories",
    "SERVICE",
    "Campus landmark.",
    "6.396977",
    "5.619176",
    [
      "Ts Beauty Accessories Benin",
      "TS Beauty Accessories Benin NO.1"
    ],
    null
  ],
  [
    "bac098df-fcc6-533c-a4d7-cf879c6972e1",
    "UBTH Blood Bank",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.393109",
    "5.611334",
    [
      "Blood Bank UBTH"
    ],
    null
  ],
  [
    "9cb4090a-03bc-540d-84e5-b56c27a06084",
    "UBTH Brachytherapy",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.39408",
    "5.611817",
    [
      "Brachy Therapy",
      "Brachytherapy UBTH"
    ],
    null
  ],
  [
    "2a86c096-41f5-5d5e-af37-c58b02697724",
    "UBTH Chemical Pathology Department",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.391535",
    "5.614093",
    [
      "Chemical Pathology Dept.UBTH",
      "Chemical Pathology UBTH"
    ],
    null
  ],
  [
    "04f6180d-1af4-5c03-a93b-9a2269a36774",
    "UBTH Dermatology and Rheumatology Clinic",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.392521",
    "5.612369",
    [
      "Ubth dermatology & Rheumatology clinic",
      "Dermatology UBTH",
      "Rheumatology UBTH"
    ],
    null
  ],
  [
    "e5301285-4bc0-5c0d-9cd3-a4d531eecbaf",
    "UBTH Paediatric Surgical Ward",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.391877",
    "5.613616",
    [
      "Pediatric Surgical Ward",
      "Paediatric Surgical Ward"
    ],
    null
  ],
  [
    "8dd0ccc9-9016-5542-a6e3-3dc99eacb859",
    "UBTH Pathology Laboratory",
    "HEALTH",
    "Nearby hospital teaching/service location.",
    "6.391832",
    "5.61433",
    [
      "Pathology Lab",
      "Pathology Lab UBTH"
    ],
    null
  ],
  [
    "dcf11440-5c29-5b36-a05f-e7125d77d228",
    "UNIBEN Anatomy Back Gate",
    "TRANSPORT",
    "Pedestrian access point near Anatomy and the medical hostel axis.",
    "6.393508",
    "5.615329",
    [
      "Anatomy Back Gate",
      "Anatomy Gate",
      "UNIBEN Anatomy Gate"
    ],
    null
  ],
  [
    "217ebcc6-f66f-51c5-a856-3271399d5549",
    "UNIBEN Basketball Court",
    "SPORT",
    "Outdoor basketball court on Ugbowo Campus.",
    "6.397415",
    "5.611257",
    [
      "Basketball Court",
      "Basketball",
      "UNIBEN Basketball Court"
    ],
    null
  ],
  [
    "31815e90-5b67-5589-9744-5fb5547481d4",
    "UNIBEN Book Shop",
    "SERVICE",
    "University bookshop and student supplies.",
    "6.401545",
    "5.620555",
    [
      "Bookshop",
      "UNIBEN Bookshop",
      "Uniben Book Shop"
    ],
    null
  ],
  [
    "1c0b7bf8-00d8-5e63-b6b7-cec847cecc64",
    "UNIBEN Central Mosque",
    "SERVICE",
    "Separate from the Hostel Mosque near the halls.",
    "6.402556",
    "5.611378",
    [
      "Uniben Central Mosque",
      "Central Mosque UNIBEN"
    ],
    null
  ],
  [
    "e2d8ea45-9bc9-5789-8133-1cb55893e588",
    "UNIBEN Education Field",
    "SPORT",
    "Open sports and activity field near the Education and Engineering areas.",
    "6.40248",
    "5.61865",
    [
      "Education Field",
      "Faculty of Education Field"
    ],
    null
  ],
  [
    "df1a80c7-3041-5f6b-96ae-945155927624",
    "UNIBEN Golf Course",
    "SPORT",
    "Campus landmark.",
    "6.396943",
    "5.61012",
    [
      "Uniben Golf Course",
      "Golf Course"
    ],
    null
  ],
  [
    "f5ad7e59-6bbf-5163-9c7d-296fb62358e2",
    "UNIBEN Gym",
    "SPORT",
    "Campus landmark.",
    "6.400391",
    "5.619634",
    [
      "Uniben Gym",
      "Education Gym"
    ],
    null
  ],
  [
    "95d8aa69-b4a7-53cf-9861-cf7b12831249",
    "UNIBEN Indoor Sports Hall",
    "SPORT",
    "Indoor sports facility on Ugbowo Campus.",
    "6.397077",
    "5.611195",
    [
      "Indoor Sports Hall",
      "Indoor Sport Hall",
      "UNIBEN Indoor Sport Hall"
    ],
    null
  ],
  [
    "fe6bd15a-4934-59cd-9233-99fc40970a66",
    "UNIBEN International ICT Centre",
    "SERVICE",
    "University ICT centre and digital services hub.",
    "6.400938",
    "5.616359",
    [
      "ICT Centre",
      "ICTU",
      "CRPU",
      "Iyayi Computer Building"
    ],
    "2026-10-01T03:35:26.871484+00:00"
  ],
  [
    "c35d97e3-bed1-5643-8f3e-7f24fb879a2e",
    "UNIBEN Mosque",
    "SERVICE",
    "Campus mosque near the student halls.",
    "6.396454",
    "5.619755",
    [
      "Students Mosque",
      "Mosque",
      "Hostel Mosque",
      "UNIBEN Hostel Mosque"
    ],
    null
  ],
  [
    "65f3124d-3690-50a6-a01e-1a7afe90eec5",
    "UNIBEN Sports Complex",
    "SPORT",
    "University sports complex.",
    "6.3992",
    "5.61295",
    [
      "Sports Complex",
      "Stadium"
    ],
    null
  ],
  [
    "e8cf4946-cc6f-5cb8-811d-cd0d6abe8025",
    "UNIBEN Swimming Pool",
    "SPORT",
    "Campus landmark.",
    "6.398627",
    "5.610645",
    [
      "Uniben Swimming Pool",
      "Swimming Pool"
    ],
    null
  ],
  [
    "0f6b5763-6398-5215-b0ea-b0195ee75d55",
    "UNIBEN Volleyball Court",
    "SPORT",
    "Campus landmark.",
    "6.39643",
    "5.610902",
    [
      "Uniben Volleyball Court",
      "Volleyball Court"
    ],
    null
  ],
  [
    "ab8fedb8-6f20-54fd-b543-22896f4e9d5b",
    "University Demonstration Secondary School",
    "ACADEMIC",
    "University Demonstration Secondary School.",
    "6.40405",
    "5.61755",
    [
      "UDSS",
      "University Demonstration School"
    ],
    null
  ],
  [
    "5c706c07-9258-54ed-ab6b-ca29736a398a",
    "University of Benin Health Centre",
    "HEALTH",
    "University health centre with student medical services.",
    "6.403913",
    "5.624728",
    [
      "Health Centre",
      "Medical Centre",
      "Uniben Health centre/hospital"
    ],
    "2026-10-01T14:05:24.968391+00:00"
  ],
  [
    "a455eda5-8e1b-5971-a57e-cf5a0d2e9e41",
    "University of Benin Health Centre Car Park",
    "TRANSPORT",
    "Campus landmark.",
    "6.404148",
    "5.624288",
    [
      "Health Centre Car Park",
      "UNIBEN Health Centre parking"
    ],
    null
  ],
  [
    "b22357c9-2fdd-51ea-8861-6fefa3fef4a0",
    "University of Benin Microfinance Bank",
    "SERVICE",
    "University of Benin Microfinance Bank campus branch.",
    "6.39776",
    "5.61724",
    [
      "UNIBEN Microfinance Bank",
      "UNIBEN MFB"
    ],
    null
  ],
  [
    "fb6d80b0-d0a7-5812-8790-0a1fb32ae423",
    "University of Benin Staff School",
    "ACADEMIC",
    "University staff school on the Ugbowo campus axis.",
    "6.40425",
    "5.62035",
    [
      "UNIBEN Staff School",
      "Staff School"
    ],
    null
  ],
  [
    "265d648c-28db-54b4-8eb8-68ddc10a4aef",
    "Wema Bank - UNIBEN",
    "SERVICE",
    "Wema Bank branch on Ugbowo Campus.",
    "6.402505",
    "5.609694",
    [
      "Wema Bank",
      "Wema UNIBEN"
    ],
    null
  ],
  [
    "745b21e8-868e-5337-8f0c-5f99770ca3fa",
    "Yotacakes 'n' More",
    "SERVICE",
    "Campus landmark.",
    "6.394562",
    "5.61799",
    [
      "yotacakes’n’more",
      "yotacakes'n'more"
    ],
    null
  ],
  [
    "8ed2bfe4-898c-5b70-b853-ba1a92fff18d",
    "YUTECH NIN & BVN Solution Hub",
    "SERVICE",
    "Campus landmark.",
    "6.392983",
    "5.615524",
    [
      "YUTECH",
      "NIN and BVN Solution Hub"
    ],
    null
  ],
  [
    "2ecc6e0e-ce20-5720-baea-d46173dd6a35",
    "Zenith Bank - UNIBEN",
    "SERVICE",
    "Zenith Bank branch on Ugbowo Campus.",
    "6.402417",
    "5.61028",
    [
      "Zenith Bank",
      "Zenith UNIBEN"
    ],
    null
  ],
  [
    "36244b22-6661-5be4-b1b8-cc05011174e7",
    "Zteller Technologies",
    "SERVICE",
    "Campus landmark.",
    "6.400098",
    "5.608965",
    [
      "Zteller Technologies"
    ],
    null
  ],
  [
    "da274dde-3a1e-5fe4-ad0d-ff9b30c66439",
    "Promise Land Restaurant",
    "FOOD",
    "Restaurant landmark in the UNIBEN bank/farm axis.",
    "6.403188",
    "5.610078",
    [
      "Promise_land Restaurant",
      "Promise land Restaurant",
      "Promise Land UNIBEN"
    ],
    null
  ],
  [
    "cf0a2dea-8b98-5113-806a-8a188c816cdf",
    "UNIBEN Farm Project",
    "ACADEMIC",
    "University farm project landmark on Ugbowo Campus.",
    "6.403063",
    "5.610922",
    [
      "Uniben Farm Project",
      "UNIBEN Farm project",
      "Farm Project"
    ],
    null
  ],
  [
    "9dd57650-a5cc-5774-b7cc-a8d985bba7a6",
    "Shopping Complex UNIBEN",
    "SERVICE",
    "Campus shopping complex behind the Fidelity Bank area.",
    "6.402388",
    "5.610422",
    [
      "UNIBEN Shopping Complex",
      "Uniben shopping complex",
      "Shopping Complex"
    ],
    null
  ]
] satisfies readonly RawStarterPlace[];

export const UNIBEN_UGBOWO_STARTER: CampusStarterDirectory = {
  campus: {
    name: "Ugbowo campus",
    slug: "ugbowo",
    latitude: "6.398255",
    longitude: "5.618838",
    map_style: "KAMPUSONE",
    status: "PUBLISHED",
  },
  places: RAW_UNIBEN_UGBOWO_PLACES.map(
    ([id, name, category, description, latitude, longitude, aliases, verifiedAt]) => ({
      id,
      name,
      category,
      description,
      latitude,
      longitude,
      accessibility_notes: null,
      image_url: null,
      search_aliases: aliases,
      verified_at: verifiedAt,
    }),
  ),
};

function normalizeUniversityName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function campusDirectoryDefaultForUniversity(
  universityName: string | null | undefined,
): CampusStarterDirectory | null {
  return normalizeUniversityName(universityName) === "university of benin"
    ? UNIBEN_UGBOWO_STARTER
    : null;
}

export function filterCampusStarterPlaces(
  places: readonly CampusStarterPlace[],
  filters: { category?: string | undefined; query?: string | undefined },
) {
  const category = filters.category?.trim().toUpperCase();
  const query = filters.query?.trim().toLowerCase();

  return places.filter((place) => {
    if (category && place.category !== category) return false;
    if (!query) return true;
    return `${place.name} ${place.description} ${place.search_aliases.join(" ")}`
      .toLowerCase()
      .includes(query);
  });
}
