export type CampusRoutingPoint = {
  latitude: number;
  longitude: number;
};

export type CampusWalkingRoute = {
  distance: number;
  duration: number;
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  steps: Array<{
    distance: number;
    duration: number;
    name: string;
    maneuver: {
      type: string;
      modifier: string | null;
    };
  }>;
};

type OsrmPayload = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { type?: string; coordinates?: unknown };
    legs?: Array<{
      steps?: Array<{
        distance?: number;
        duration?: number;
        name?: string;
        maneuver?: { type?: string; modifier?: string };
      }>;
    }>;
  }>;
};

export class CampusRoutingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampusRoutingProviderError";
  }
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function validCoordinates(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        typeof coordinate[0] === "number" &&
        Number.isFinite(coordinate[0]) &&
        typeof coordinate[1] === "number" &&
        Number.isFinite(coordinate[1]),
    )
  );
}

export async function fetchCampusWalkingRoute(options: {
  baseUrl?: string;
  from: CampusRoutingPoint;
  to: CampusRoutingPoint;
  timeoutMs?: number;
}) {
  const baseUrl = (
    options.baseUrl?.trim() ||
    "https://routing.openstreetmap.de/routed-foot/route/v1/driving"
  ).replace(/\/$/, "");
  const coordinates = `${options.from.longitude},${options.from.latitude};${options.to.longitude},${options.to.latitude}`;
  const url = `${baseUrl}/${coordinates}?alternatives=false&overview=full&geometries=geojson&steps=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_500);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "KampusOne campus-navigation/0.3" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CampusRoutingProviderError(
        `Campus routing provider returned HTTP ${response.status}.`,
      );
    }
    const payload = (await response.json()) as OsrmPayload;
    const route = payload.routes?.[0];
    if (
      payload.code !== "Ok" ||
      !route ||
      route.geometry?.type !== "LineString" ||
      !validCoordinates(route.geometry.coordinates)
    ) {
      throw new CampusRoutingProviderError(
        "Campus routing provider returned no usable walking route.",
      );
    }

    return {
      distance: finite(route.distance),
      duration: finite(route.duration),
      geometry: {
        type: "LineString" as const,
        coordinates: route.geometry.coordinates,
      },
      steps: (route.legs ?? []).flatMap((leg) =>
        (leg.steps ?? []).map((step) => ({
          distance: finite(step.distance),
          duration: finite(step.duration),
          name: step.name?.trim() ?? "",
          maneuver: {
            type: step.maneuver?.type?.trim() || "continue",
            modifier: step.maneuver?.modifier?.trim() || null,
          },
        })),
      ),
    } satisfies CampusWalkingRoute;
  } catch (caught) {
    if (caught instanceof CampusRoutingProviderError) throw caught;
    if (caught instanceof Error && caught.name === "AbortError") {
      throw new CampusRoutingProviderError("Campus routing provider timed out.");
    }
    throw new CampusRoutingProviderError("Campus routing provider is unavailable.");
  } finally {
    clearTimeout(timer);
  }
}
