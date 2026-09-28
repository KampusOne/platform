export type CampusBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type CampusPoint = {
  latitude: number;
  longitude: number;
};

export function parseCoordinate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCampusBounds(value: unknown): CampusBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof CampusBounds, unknown>>;
  const north = parseCoordinate(candidate.north as string | number | null | undefined);
  const south = parseCoordinate(candidate.south as string | number | null | undefined);
  const east = parseCoordinate(candidate.east as string | number | null | undefined);
  const west = parseCoordinate(candidate.west as string | number | null | undefined);
  if (north === null || south === null || east === null || west === null) return null;
  if (north <= south || east <= west) return null;
  return { north, south, east, west };
}

export function pointInsideCampus(point: CampusPoint, bounds: CampusBounds | null) {
  if (!bounds) return false;
  return point.latitude >= bounds.south &&
    point.latitude <= bounds.north &&
    point.longitude >= bounds.west &&
    point.longitude <= bounds.east;
}

export function distanceMetres(a: CampusPoint, b: CampusPoint) {
  const earthRadius = 6_371_000;
  const latitudeA = (a.latitude * Math.PI) / 180;
  const latitudeB = (b.latitude * Math.PI) / 180;
  const latitudeDelta = ((b.latitude - a.latitude) * Math.PI) / 180;
  const longitudeDelta = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function shouldRefreshWalkingRoute(
  previous: CampusPoint | null,
  current: CampusPoint,
  lastRequestedAt: number,
  now = Date.now(),
) {
  if (!previous) return true;
  if (now - lastRequestedAt < 15_000) return false;
  return distanceMetres(previous, current) >= 20;
}

export function formatWalkingDistance(metres: number) {
  if (metres < 1000) return String(Math.max(1, Math.round(metres))) + " m";
  const kilometres = metres / 1000;
  return kilometres.toFixed(kilometres >= 10 ? 0 : 1) + " km";
}

export function formatWalkingDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return String(minutes) + " min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? String(hours) + " hr " + String(remainder) + " min" : String(hours) + " hr";
}
