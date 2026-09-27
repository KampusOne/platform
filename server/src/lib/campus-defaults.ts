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

const REVIEWED_AT = "2026-09-27T00:00:00.000Z";

export const UNIBEN_UGBOWO_STARTER: CampusStarterDirectory = {
  campus: {
    name: "Ugbowo campus",
    slug: "ugbowo",
    latitude: "6.398255",
    longitude: "5.618838",
    map_style: "KAMPUSONE",
    status: "PUBLISHED",
  },
  places: [
    {
      id: "5a3e978c-8d07-411c-bd0d-1b08313fe128",
      name: "Student Affairs Division",
      category: "SERVICE",
      description: "Student Affairs Division, University of Benin Ugbowo Campus.",
      latitude: "6.400023",
      longitude: "5.609885",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "a64fc253-2c9e-407c-b852-b077e0390d5b",
      name: "Faculty of Engineering",
      category: "ACADEMIC",
      description: "Faculty of Engineering, University of Benin Ugbowo Campus.",
      latitude: "6.401790",
      longitude: "5.615370",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "4abd5761-6388-46f0-b20d-e3aef1f4f1c2",
      name: "Faculty of Physical Sciences",
      category: "ACADEMIC",
      description: "Faculty of Physical Sciences, University of Benin Ugbowo Campus.",
      latitude: "6.400310",
      longitude: "5.615350",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "f61bd3ec-dbdf-498d-aaab-c867c8c77522",
      name: "Faculty of Life Sciences",
      category: "ACADEMIC",
      description: "Faculty of Life Sciences, University of Benin Ugbowo Campus.",
      latitude: "6.398940",
      longitude: "5.614870",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "c1a6b966-0cec-427d-8672-fe1df10ae369",
      name: "Faculty of Education",
      category: "ACADEMIC",
      description: "Faculty of Education, University of Benin Ugbowo Campus.",
      latitude: "6.400910",
      longitude: "5.619670",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "e1ab63c1-5fbd-4a41-9a4d-f2c0b18d7fae",
      name: "Faculty of Law",
      category: "ACADEMIC",
      description: "Faculty of Law, University of Benin Ugbowo Campus.",
      latitude: "6.400530",
      longitude: "5.622440",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "f66a29bf-08dc-43b6-be7a-d66c099613a5",
      name: "JUPEB Foundation School",
      category: "ACADEMIC",
      description: "UNIBEN JUPEB Foundation School, Ugbowo Campus.",
      latitude: "6.397003",
      longitude: "5.617815",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "99189c22-3c1b-4d07-baf5-81a1544aa283",
      name: "Clinical Hostel",
      category: "HOSTEL",
      description: "Clinical Hostel, University of Benin Ugbowo Campus.",
      latitude: "6.394530",
      longitude: "5.617190",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "8918a6f0-c56a-432f-b8d1-0d6aed349b57",
      name: "NDDC Hostel",
      category: "HOSTEL",
      description: "NDDC Hostel, University of Benin Ugbowo Campus.",
      latitude: "6.394710",
      longitude: "5.617890",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "f9d9e845-ec23-4ef6-90da-aa84a651a5d6",
      name: "Food Court (Buka)",
      category: "FOOD",
      description: "Campus food court (Buka), University of Benin Ugbowo Campus.",
      latitude: "6.395260",
      longitude: "5.619070",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "647a85ab-9396-45c4-b427-bebb7d3dcf3b",
      name: "Hall 5 Hostel",
      category: "HOSTEL",
      description: "Hall 5 student hostel, University of Benin Ugbowo Campus.",
      latitude: "6.397120",
      longitude: "5.623920",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "68a12e6f-640c-4412-8cf6-63a5502d454c",
      name: "Hall 6 Hostel",
      category: "HOSTEL",
      description: "Hall 6 student hostel, University of Benin Ugbowo Campus.",
      latitude: "6.398220",
      longitude: "5.626190",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
    {
      id: "5931353c-3b42-4b13-a5f6-a48ff024c92d",
      name: "Hall 7 Hostel",
      category: "HOSTEL",
      description: "Hall 7 student hostel, University of Benin Ugbowo Campus.",
      latitude: "6.397970",
      longitude: "5.625230",
      accessibility_notes: null,
      image_url: null,
      verified_at: REVIEWED_AT,
    },
  ],
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
  filters: { category?: string; query?: string },
) {
  const category = filters.category?.trim().toUpperCase();
  const query = filters.query?.trim().toLowerCase();

  return places.filter((place) => {
    if (category && place.category !== category) return false;
    if (!query) return true;
    return `${place.name} ${place.description}`.toLowerCase().includes(query);
  });
}
