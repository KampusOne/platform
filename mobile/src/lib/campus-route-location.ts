import type {CampusLiveLocation} from './campus-location';

/** Navigation needs a recent, reasonably accurate device fix, not merely a cached map dot. */
export const MAX_ROUTE_GPS_AGE_MS=60_000;
export const MAX_ROUTE_GPS_ACCURACY_METRES=50;

export function usableRouteGpsFix(fix:CampusLiveLocation|null,now=Date.now()):boolean{
  return Boolean(
    fix&&Number.isFinite(fix.latitude)&&Number.isFinite(fix.longitude)&&
    Math.abs(fix.latitude)<=90&&Math.abs(fix.longitude)<=180&&
    fix.accuracy!==null&&Number.isFinite(fix.accuracy)&&
    fix.accuracy>=0&&fix.accuracy<=MAX_ROUTE_GPS_ACCURACY_METRES&&
    Number.isFinite(fix.timestamp)&&fix.timestamp<=now+5000&&
    now-fix.timestamp<=MAX_ROUTE_GPS_AGE_MS
  );
}
