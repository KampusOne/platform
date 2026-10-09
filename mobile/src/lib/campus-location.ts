import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { preferredCampusLocation, routeGpsProblem, usableRouteGpsFix } from "./campus-route-location";

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
  preciseAllowed: boolean;
  servicesEnabled: boolean;
};

export const CAMPUS_LOCATION_WAIT_MS = 12_000;
const PRECISE_LOCATION_MESSAGE = 'Precise location is off for KampusOne. Enable it in Settings, or choose a starting point.';

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
    preciseAllowed: true,
    servicesEnabled: true,
  });
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const focusedRef = useRef(false);
  const generationRef = useRef(0);
  const positionRef = useRef<CampusLiveLocation | null>(null);
  const pendingRef = useRef<((position: CampusLiveLocation | null) => void) | null>(null);

  const stopWatching = useCallback(() => {
    generationRef.current++;
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    pendingRef.current?.(null);
    pendingRef.current = null;
  }, []);

  const beginWatching = useCallback((generation: number, preciseAllowed: boolean) => {
    const active = () => focusedRef.current && generationRef.current === generation;
    return new Promise<CampusLiveLocation | null>((resolve) => {
      let settled = false;
      const finish = (position: CampusLiveLocation | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (pendingRef.current === finish) pendingRef.current = null;
        resolve(position);
      };
      // Keep watching after the bounded initial wait so a later good fix resumes directions automatically.
      const timeout = setTimeout(() => {
        if (active()) setState((current) => ({
          ...current,
          loading: false,
          error: current.error || (preciseAllowed && usableRouteGpsFix(positionRef.current) ? '' : preciseAllowed ? routeGpsProblem(positionRef.current) : PRECISE_LOCATION_MESSAGE),
        }));
        finish(preciseAllowed && usableRouteGpsFix(positionRef.current) ? positionRef.current : null);
      }, CAMPUS_LOCATION_WAIT_MS);
      pendingRef.current = finish;

      const publish = (location: Location.LocationObject, source: 'cached' | 'live' = 'live') => {
        if (!active()) return;
        const incoming = normalizeLocation(location, source);
        const position = preferredCampusLocation(positionRef.current, incoming);
        positionRef.current = position;
        const ready = preciseAllowed && usableRouteGpsFix(position);
        setState((current) => ({
          ...current,
          position,
          error: !preciseAllowed ? PRECISE_LOCATION_MESSAGE : ready ? '' : settled ? routeGpsProblem(position) : '',
          loading: preciseAllowed && !ready && !settled,
          servicesEnabled: true,
        }));
        if (source === 'live' && ready) finish(position);
      };
      const watchFailed = () => {
        if (!active() || !settled || usableRouteGpsFix(positionRef.current)) return;
        setState((current) => ({ ...current, loading: false, error: current.error || 'Live location updates paused. Retry, or choose a starting point.' }));
      };

      void Location.hasServicesEnabledAsync().then((servicesEnabled) => {
        if (!active()) return;
        if (!servicesEnabled) {
          setState((current) => ({ ...current, loading: false, servicesEnabled: false, error: 'Device location is off. Turn it on in Settings, or choose a starting point.' }));
          finish(null);
          return;
        }
        setState((current) => ({ ...current, servicesEnabled: true }));

        // Start the subscription before either optional cache or one-shot request can stall.
        void Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 2_500, mayShowUserSettingsDialog: true },
          (location) => publish(location),
          watchFailed,
        ).then((subscription) => {
          if (active()) subscriptionRef.current = subscription;
          else subscription.remove();
        }).catch(watchFailed);

        void Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 150 })
          .then((location) => { if (location) publish(location, 'cached'); }).catch(() => {});
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: true })
          .then((location) => publish(location)).catch(watchFailed);
        if (!preciseAllowed) finish(null);
      }).catch(() => {
        if (!active()) return;
        setState((current) => ({ ...current, loading: false, servicesEnabled: false, error: 'KampusOne could not check device location. Retry, or choose a starting point.' }));
        finish(null);
      });
    });
  }, []);

  const refreshPermission = useCallback(async (request: boolean) => {
    stopWatching();
    const generation = generationRef.current;
    const active = () => focusedRef.current && generationRef.current === generation;
    if (!active()) return null;
    setState((current) => ({ ...current, error: '', loading: true }));

    let permission: Location.LocationPermissionResponse;
    try {
      permission = request ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    } catch {
      if (active()) setState((current) => ({ ...current, error: 'KampusOne could not read location permission. Retry, or choose a starting point.', loading: false }));
      return null;
    }
    if (!active()) return null;

    const preciseAllowed = permission.android?.accuracy !== 'coarse' && permission.ios?.accuracy !== 'reduced';
    const granted = permission.status === Location.PermissionStatus.GRANTED;
    setState((current) => ({
      ...current,
      canAskAgain: permission.canAskAgain,
      error: !granted ? (permission.status === Location.PermissionStatus.DENIED ? 'Location permission is off for KampusOne. Allow it in Settings, or choose a starting point.' : '') : !preciseAllowed ? PRECISE_LOCATION_MESSAGE : '',
      loading: granted && preciseAllowed,
      permission: permission.status,
      preciseAllowed,
    }));
    return granted ? beginWatching(generation, preciseAllowed) : null;
  }, [beginWatching, stopWatching]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void refreshPermission(false);
    // Returning from device settings must recheck permission and restart the sensor subscription.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshPermission(false);
      else stopWatching();
    });
    return () => {
      focusedRef.current = false;
      appState.remove();
      stopWatching();
    };
  }, [refreshPermission, stopWatching]));

  const requestLocation = useCallback(() => refreshPermission(true), [refreshPermission]);
  const retryLocation = useCallback(() => refreshPermission(false), [refreshPermission]);
  const openLocationSettings = useCallback(async () => {
    try {
      if (!state.servicesEnabled && Platform.OS === 'android') await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      else await Linking.openSettings();
    } catch {
      if (focusedRef.current) setState((current) => ({ ...current, error: 'Open device Settings to enable location for KampusOne, or choose a starting point.' }));
    }
  }, [state.servicesEnabled]);

  return { ...state, requestLocation, retryLocation, openLocationSettings };
}
