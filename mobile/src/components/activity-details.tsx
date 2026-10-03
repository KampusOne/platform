import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppearance } from '@/src/lib/appearance';
import type { SocialFeedPost } from '@/src/lib/feed-social';
import { serverDate } from '@/src/lib/server-date';

export function ActivityDetails({ post, onError }: { post: SocialFeedPost; onError(message: string): void }) {
  const { theme } = useAppearance();
  const activity = post.activity;
  if (!activity) return null;
  const date = serverDate(activity.startsAt ?? activity.deadline);
  const link = activity.registrationUrl;
  const validLink = typeof link === 'string' && /^https?:\/\//i.test(link);
  return <View style={{ gap: 9, paddingVertical: 12 }}>
    {activity.venue ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Ionicons name="location-outline" color={theme.textMuted} size={16} /><Text style={{ color: theme.text, fontFamily: theme.font.body, flex: 1 }}>{activity.venue}</Text></View> : null}
    {date ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Ionicons name="calendar-outline" color={theme.textMuted} size={16} /><Text style={{ color: theme.text, fontFamily: theme.font.body }}>{activity.deadline ? 'Apply by ' : ''}{date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(activity.startsAt ? { hour: 'numeric', minute: '2-digit' } : {}) })}</Text></View> : null}
    {validLink ? <Pressable accessibilityRole="link" accessibilityLabel={activity.deadline ? 'Open application website' : 'Open event registration website'} onPress={() => void Linking.openURL(link).catch(() => onError('This website could not be opened. Please try again.'))} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 }}><Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold }}>{activity.deadline ? 'Apply on the organiser’s website' : 'Register on the organiser’s website'}</Text><Ionicons name="open-outline" size={16} color={theme.deepBrand} /></Pressable> : null}
  </View>;
}
