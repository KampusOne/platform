type OsmTags = Record<string, string | undefined>;

type OverpassElement = {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: OsmTags;
};

export type ImportedCampusPlace = {
  aliases: string[];
  category:
    | "ACADEMIC"
    | "FOOD"
    | "HEALTH"
    | "HOSTEL"
    | "SERVICE"
    | "SPORT"
    | "TRANSPORT";
  description: string;
  latitude: number;
  longitude: number;
  name: string;
  sourceRef: string;
  sourceUrl: string;
};

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 300;

function categoryFor(tags: OsmTags): ImportedCampusPlace["category"] {
  const amenity = tags.amenity;
  const building = tags.building;
  const leisure = tags.leisure;
  const tourism = tags.tourism;

  if (
    amenity === "university" ||
    amenity === "college" ||
    amenity === "school" ||
    amenity === "library"
  ) return "ACADEMIC";

  if (
    amenity === "restaurant" ||
    amenity === "fast_food" ||
    amenity === "cafe" ||
    amenity === "food_court"
  ) return "FOOD";

  if (
    amenity === "clinic" ||
    amenity === "hospital" ||
    amenity === "pharmacy" ||
    amenity === "doctors" ||
    amenity === "dentist"
  ) return "HEALTH";

  if (
    building === "dormitory" ||
    tourism === "hostel" ||
    tags.residential === "university"
  ) return "HOSTEL";

  if (
    leisure === "sports_centre" ||
    leisure === "pitch" ||
    leisure === "stadium" ||
    leisure === "track"
  ) return "SPORT";

  if (
    amenity === "bus_station" ||
    amenity === "taxi" ||
    tags.highway === "bus_stop" ||
    tags.public_transport === "platform" ||
    tags.public_transport === "station"
  ) return "TRANSPORT";

  return building ? "ACADEMIC" : "SERVICE";
}

function aliasesFor(tags: OsmTags, name: string) {
  return [tags.short_name, tags.alt_name, tags.official_name, tags.ref]
    .flatMap((value) => value?.split(";") ?? [])
    .map((value) => value.trim())
    .filter((value, index, values) =>
      Boolean(value) &&
      value.toLowerCase() !== name.toLowerCase() &&
      values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index,
    )
    .slice(0, 12);
}

function buildQuery(latitude: number, longitude: number, radiusMeters: number) {
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  return `[out:json][timeout:25];
(
  nwr${around}["name"]["building"];
  nwr${around}["name"]["amenity"~"university|college|school|library|clinic|hospital|pharmacy|doctors|dentist|bank|atm|restaurant|fast_food|cafe|food_court|place_of_worship|bus_station|taxi"];
  nwr${around}["name"]["leisure"~"sports_centre|pitch|stadium|track"];
  nwr${around}["name"]["tourism"="hostel"];
  nwr${around}["name"]["highway"="bus_stop"];
  nwr${around}["name"]["public_transport"~"platform|station"];
);
out center tags ${MAX_RESULTS};`;
}

export async function importCampusPlacesFromOpenStreetMap(options: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  endpoint?: string;
}): Promise<ImportedCampusPlace[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(options.endpoint ?? DEFAULT_OVERPASS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "KampusOne/0.2 (+https://kampusone.app)",
      },
      body: new URLSearchParams({
        data: buildQuery(
          options.latitude,
          options.longitude,
          options.radiusMeters,
        ),
      }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenStreetMap import failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as { elements?: OverpassElement[] };
    const seen = new Set<string>();
    const results: ImportedCampusPlace[] = [];

    for (const element of payload.elements ?? []) {
      const name = element.tags?.name?.trim();
      const latitude = element.lat ?? element.center?.lat;
      const longitude = element.lon ?? element.center?.lon;
      if (
        !name ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) continue;

      const sourceRef = `${element.type}:${element.id}`;
      if (seen.has(sourceRef)) continue;
      seen.add(sourceRef);

      results.push({
        aliases: aliasesFor(element.tags ?? {}, name),
        category: categoryFor(element.tags ?? {}),
        description: "Imported from OpenStreetMap. Review before publishing.",
        latitude: latitude as number,
        longitude: longitude as number,
        name,
        sourceRef,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      });
    }

    return results.slice(0, MAX_RESULTS);
  } finally {
    clearTimeout(timer);
  }
}
