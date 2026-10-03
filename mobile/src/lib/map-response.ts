type Coordinate = [number, number];
export function validMapCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
export type CampusRouteResponse = {
  distanceMetres: number;
  durationSeconds: number;
  geometry: {type: 'LineString'; coordinates: Coordinate[]};
  notice: string | null;
  instructions: string[];
};
/** Do not turn a partial response into a route or pass arbitrary objects to Text. */
export function readCampusRoute(value: unknown): CampusRouteResponse {
  const data = value as Partial<CampusRouteResponse> | null;
  if (!data || !Number.isFinite(data.distanceMetres) || data.distanceMetres! < 0 || data.distanceMetres! > 100000 ||
      !Number.isFinite(data.durationSeconds) || data.durationSeconds! < 0 ||
      data.geometry?.type !== 'LineString' || !Array.isArray(data.geometry.coordinates) ||
      data.geometry.coordinates.length < 2 || data.geometry.coordinates.length > 20000 ||
      !data.geometry.coordinates.every(validMapCoordinate))
    throw new Error('These directions could not be read. Try again, or choose another mapped entrance.');
  return {
    distanceMetres: data.distanceMetres!, durationSeconds: data.durationSeconds!, geometry: data.geometry,
    notice: typeof data.notice === 'string' ? data.notice.slice(0,1000) : null,
    instructions: Array.isArray(data.instructions) ? data.instructions.filter((line): line is string => typeof line === 'string').slice(0,100) : [],
  };
}
