export type LngLat = [longitude: number, latitude: number];

export type CampusPlace = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  latitude: string | null;
  longitude: string | null;
  accessibility_notes: string | null;
  image_url: string | null;
  verified_at: string | null;
};

export type MappedCampusPlace = CampusPlace & {
  latitudeValue: number;
  longitudeValue: number;
};

export type CampusDirectory = {
  name: string;
  slug: string;
  latitude: string;
  longitude: string;
  map_style?: string;
  status?: string;
  boundary?: LngLat[] | null;
};

export type CampusDirectoryResponse = {
  campus: CampusDirectory | null;
  places: CampusPlace[];
  directorySource: "DATABASE" | "STARTER" | "EMPTY";
};

export type CampusLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
};

export type CampusRouteStep = {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  name: string | null;
  maneuverType: string | null;
  maneuverModifier: string | null;
  location: LngLat | null;
};

export type CampusWalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LngLat[];
  steps: CampusRouteStep[];
};

export const CAMPUS_MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";

export const FALLBACK_CAMPUS_CENTER: LngLat = [5.618838, 6.398255];

export function mapCampusPlace(place: CampusPlace): MappedCampusPlace | null {
  if (!place.latitude?.trim() || !place.longitude?.trim()) return null;
  const latitudeValue = Number(place.latitude);
  const longitudeValue = Number(place.longitude);
  if (
    !Number.isFinite(latitudeValue) ||
    !Number.isFinite(longitudeValue) ||
    latitudeValue < -90 ||
    latitudeValue > 90 ||
    longitudeValue < -180 ||
    longitudeValue > 180
  ) {
    return null;
  }
  return { ...place, latitudeValue, longitudeValue };
}

export function campusCenter(campus: CampusDirectory | null): LngLat {
  if (!campus) return FALLBACK_CAMPUS_CENTER;
  const latitude = Number(campus.latitude);
  const longitude = Number(campus.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return FALLBACK_CAMPUS_CENTER;
  return [longitude, latitude];
}

export function pointInPolygon(point: LngLat, polygon: LngLat[]) {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index]!;
    const [xj, yj] = polygon[previous]!;
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distanceMetres(a: LngLat, b: LngLat) {
  const radius = 6_371_000;
  const latitudeA = (a[1] * Math.PI) / 180;
  const latitudeB = (b[1] * Math.PI) / 180;
  const latitudeDelta = ((b[1] - a[1]) * Math.PI) / 180;
  const longitudeDelta = ((b[0] - a[0]) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function isInsideCampus(
  location: CampusLocation | null,
  campus: CampusDirectory | null,
) {
  if (!location) return false;
  const point: LngLat = [location.longitude, location.latitude];
  const boundary = campus?.boundary ?? [];
  if (boundary.length >= 3) return pointInPolygon(point, boundary);
  return distanceMetres(point, campusCenter(campus)) <= 1_900;
}

export function shouldRefreshWalkingRoute(
  previous: LngLat | null,
  current: LngLat,
  lastRequestedAt: number,
  now = Date.now(),
) {
  if (!previous) return true;
  if (now - lastRequestedAt < 12_000) return false;
  return distanceMetres(previous, current) >= 30;
}

export function formatDistance(metres: number) {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 1000) return `${Math.max(1, Math.round(metres))} m`;
  return `${(metres / 1000).toFixed(metres >= 10_000 ? 0 : 1)} km`;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function categoryLabel(value: string) {
  const normalized = value.trim().toUpperCase();
  const labels: Record<string, string> = {
    ACADEMIC: "Academic",
    SERVICE: "Services",
    TRANSPORT: "Transport",
    HOSTEL: "Hostels",
    FOOD: "Food",
    HEALTH: "Health",
    SPORT: "Sports",
  };
  return labels[normalized] ?? normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

export function categoryIcon(value: string) {
  const normalized = value.trim().toUpperCase();
  const icons: Record<string, string> = {
    ACADEMIC: "school",
    SERVICE: "help-buoy",
    TRANSPORT: "bus",
    HOSTEL: "bed",
    FOOD: "restaurant",
    HEALTH: "medkit",
    SPORT: "football",
  };
  return icons[normalized] ?? "location";
}
