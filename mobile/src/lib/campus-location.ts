import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useRef, useState } from "react";

export type CampusLiveLocation = {
  accuracy: number | null;
  source: 'cached' | 'live';
  latitude: number;
  longitude: number;
  timestamp: number;
};

export type CampusLocationState = {
  canAskAgain: boolean;
  error: string;
  loading: boolean;
  permission: Location.PermissionStatus;
  position: CampusLiveLocation | null;
  servicesEnabled: boolean;
};

function normalizeLocation(location: Location.LocationObject, source: 'cached' | 'live' = 'live'): CampusLiveLocation {
  return {
    accuracy: location.coords.accuracy,
    source,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: location.timestamp,
  };
}

export function useCampusLocation() {
  const [state, setState] = useState<CampusLocationState>({
    canAskAgain: true,
    error: "",
    loading: false,
    permission: Location.PermissionStatus.UNDETERMINED,
    position: null,
    servicesEnabled: true,
  });
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const focusedRef = useRef(false);

  const stopWatching = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  const beginWatching = useCallback(async () => {
    stopWatching();

    let servicesEnabled = false;
    try {
      servicesEnabled = await Location.hasServicesEnabledAsync();
    } catch {
      if (focusedRef.current) {
        setState((current) => ({
          ...current,
          error: "KampusOne could not check your device location service.",
          loading: false,
          servicesEnabled: false,
        }));
      }
      return null;
    }

    if (!focusedRef.current) return null;

    if (!servicesEnabled) {
      setState((current) => ({
        ...current,
        error: "Turn on device location to use your live campus position.",
        loading: false,
        servicesEnabled: false,
      }));
      return null;
    }

    setState((current) => ({
      ...current,
      error: "",
      servicesEnabled: true,
    }));

    let firstPosition: CampusLiveLocation | null = null;

    try {
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 30_000,
        requiredAccuracy: 150,
      });
      if (lastKnown && focusedRef.current) {
        firstPosition = normalizeLocation(lastKnown, 'cached');
        setState((current) => ({
          ...current,
          position: firstPosition,
        }));
      }
    } catch {
      // A cached position is optional. Continue to the live fix.
    }

    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      if (focusedRef.current) {
        firstPosition = normalizeLocation(current);
        setState((previous) => ({
          ...previous,
          error: "",
          loading: false,
          position: firstPosition,
          servicesEnabled: true,
        }));
      }
    } catch {
      if (focusedRef.current) {
        setState((current) => ({
          ...current,
          error: "KampusOne could not get your current location.",
          loading: false,
        }));
      }
    }

    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 3,
          timeInterval: 2_500,
        },
        (location) => {
          if (!focusedRef.current) return;
          setState((current) => ({
            ...current,
            error: "",
            loading: false,
            position: normalizeLocation(location),
            servicesEnabled: true,
          }));
        },
        () => {
          if (!focusedRef.current) return;
          setState((current) => ({
            ...current,
            error: "Live location updates paused. Tap current location to retry.",
            loading: false,
          }));
        },
      );

      if (focusedRef.current) {
        subscriptionRef.current = subscription;
      } else {
        subscription.remove();
      }
    } catch {
      if (focusedRef.current) {
        setState((current) => ({
          ...current,
          error: "Live location updates are unavailable right now.",
          loading: false,
        }));
      }
    }

    return firstPosition;
  }, [stopWatching]);

  const refreshPermission = useCallback(
    async (request: boolean) => {
      if (focusedRef.current) {
        setState((current) => ({ ...current, loading: true }));
      }

      let permission: Location.LocationPermissionResponse;
      try {
        permission = request
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
      } catch {
        if (focusedRef.current) {
          setState((current) => ({
            ...current,
            error: "KampusOne could not read your location permission.",
            loading: false,
          }));
        }
        return null;
      }

      if (!focusedRef.current) return null;

      setState((current) => ({
        ...current,
        canAskAgain: permission.canAskAgain,
        error:
          permission.status === Location.PermissionStatus.DENIED
            ? "Location permission is off for KampusOne."
            : "",
        loading: permission.status === Location.PermissionStatus.GRANTED,
        permission: permission.status,
      }));

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        stopWatching();
        setState((current) => ({ ...current, loading: false }));
        return null;
      }

      return beginWatching();
    },
    [beginWatching, stopWatching],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void refreshPermission(false);

      return () => {
        focusedRef.current = false;
        stopWatching();
      };
    }, [refreshPermission, stopWatching]),
  );

  const requestLocation = useCallback(
    () => refreshPermission(true),
    [refreshPermission],
  );

  return {
    ...state,
    requestLocation,
    retryLocation: beginWatching,
  };
}
