import AsyncStorage from "@react-native-async-storage/async-storage";
import {campusDateKey} from "./alarm-followup";

const KEY = "k1.first-class-reminder-choice-date";
let pending: Promise<unknown> = Promise.resolve();

/** Show the optional class mute decision once a day, after the first dismissal. */
export function shouldOfferClassAlarmChoice(): Promise<boolean> {
  const check = pending.catch(() => undefined).then(async () => {
    const today = campusDateKey();
    try {
      if (await AsyncStorage.getItem(KEY) === today) return false;
      await AsyncStorage.setItem(KEY, today);
      return true;
    } catch {
      // Device storage may be unavailable. Never block dismissing a ringing alarm.
      return true;
    }
  });
  pending = check;
  return check;
}
