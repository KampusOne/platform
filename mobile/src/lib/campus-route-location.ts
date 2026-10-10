import type {CampusLiveLocation} from './campus-location';

/** Navigation needs a recent, reasonably accurate device fix, not merely a cached map dot. */
export const MAX_ROUTE_GPS_AGE_MS=60_000;
export const MAX_ROUTE_CACHED_GPS_AGE_MS=15_000;
export const MAX_ROUTE_GPS_ACCURACY_METRES=50;

export function usableRouteGpsFix(fix:CampusLiveLocation|null,now=Date.now()):boolean{
  return Boolean(
    fix&&Number.isFinite(fix.latitude)&&Number.isFinite(fix.longitude)&&
    Math.abs(fix.latitude)<=90&&Math.abs(fix.longitude)<=180&&
    fix.accuracy!==null&&Number.isFinite(fix.accuracy)&&
    fix.accuracy>=0&&fix.accuracy<=MAX_ROUTE_GPS_ACCURACY_METRES&&
    Number.isFinite(fix.timestamp)&&fix.timestamp<=now+5000&&
    now-fix.timestamp<=(fix.source==='cached'?MAX_ROUTE_CACHED_GPS_AGE_MS:MAX_ROUTE_GPS_AGE_MS)
  );
}

/** Delayed cache/one-shot results and a poor sensor reading must not displace a good live fix. */
export function preferredCampusLocation(previous:CampusLiveLocation|null,next:CampusLiveLocation,now=Date.now()):CampusLiveLocation|null{
  if(!Number.isFinite(next.latitude)||!Number.isFinite(next.longitude)||Math.abs(next.latitude)>90||Math.abs(next.longitude)>180||!Number.isFinite(next.timestamp)||next.timestamp>now+5000)return previous;
  if(usableRouteGpsFix(previous,now)&&!usableRouteGpsFix(next,now))return previous;
  if(usableRouteGpsFix(next,now)&&!usableRouteGpsFix(previous,now))return next;
  if(previous&&previous.timestamp>next.timestamp)return previous;
  if(previous?.source==='live'&&next.source==='cached'&&now-previous.timestamp<=MAX_ROUTE_GPS_AGE_MS)return previous;
  return next;
}

export function routeGpsProblem(fix:CampusLiveLocation|null,now=Date.now()):string{
  if(fix?.accuracy!==null&&fix?.accuracy!==undefined&&Number.isFinite(fix.accuracy)&&fix.accuracy>MAX_ROUTE_GPS_ACCURACY_METRES)return `Your location is approximate (within ${Math.round(fix.accuracy)} m). Move to an open area, retry, or choose a starting point.`;
  if(fix&&now-fix.timestamp>MAX_ROUTE_GPS_AGE_MS)return 'Your location needs refreshing. Retry, or choose a starting point.';
  return 'Your current location is not available yet. Retry, or choose a starting point.';
}
