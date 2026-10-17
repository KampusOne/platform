import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/auth-context';
import { api } from '@/src/lib/api';
import { useThemeStyles, type Theme } from '@/src/lib/appearance';
import { currentExamPeriod, examCountdown, formatExamDate, type ExamPeriod } from '@/src/lib/exam-period';

export function AcademicExamStatus() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${user?.universityId ?? ''}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; periods: ExamPeriod[] } | null>(null);
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Minute precision keeps this small card from re-rendering the profile.
    const tick = () => {
      if (timer) clearTimeout(timer);
      if (AppState.currentState !== 'active') return;
      const time = Date.now();
      setNow(time);
      timer = setTimeout(tick, 60_000 - time % 60_000 + 10);
    };
    tick();
    const app = AppState.addEventListener('change', tick);
    void api<{ examPeriods: ExamPeriod[] }>('/v1/calendar/exam-periods')
      .then(data => { if (live) setSnapshot({ scope, periods: Array.isArray(data.examPeriods) ? data.examPeriods : [] }); })
      .catch(() => undefined);
    return () => { live = false; if (timer) clearTimeout(timer); app.remove(); };
  }, [scope, user?.id]));
  const period = currentExamPeriod(snapshot?.scope === scope ? snapshot.periods : [], now);
  if (!period) return null;
  const countdown = examCountdown(period, now);
  const ongoing = countdown.phase === 'ongoing';
  const unit = countdown.daysRemaining === 1 ? 'day' : 'days';
  const date = `${formatExamDate(period.startsOn)} – ${formatExamDate(period.endsOn)}`;
  return <Pressable accessibilityRole="button"
    accessibilityLabel={`${ongoing ? 'Exams in progress' : 'Exam countdown'}, ${countdown.daysRemaining} ${unit} ${ongoing ? 'left' : 'to go'}. ${date}. View countdown.`}
    onPress={() => router.push('/exam-countdown')}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.icon}><Ionicons name="calendar-outline" size={22} color={theme.deepBrand} /></View>
    <View style={styles.copy}><Text style={styles.title}>{ongoing ? 'Exams in progress' : 'Exam countdown'}</Text><Text style={styles.dates}>{date}</Text></View>
    <View style={styles.count}><Text style={styles.number}>{countdown.daysRemaining}</Text><Text style={styles.unit}>{unit} {ongoing ? 'left' : 'to go'}</Text></View>
    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
  </Pressable>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 16, marginBottom: 8, padding: 16, minHeight: 100, borderWidth: 1, borderColor: theme.border, borderRadius: 20, backgroundColor: theme.surface, flexDirection: 'row', gap: 12, alignItems: 'center' },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.surfaceTint },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 14, lineHeight: 20, fontFamily: theme.font.semibold, color: theme.text },
  dates: { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 11, lineHeight: 16 },
  count: { alignItems: 'center', minWidth: 54, gap: 1 },
  number: { fontFamily: theme.font.displayStrong, color: theme.deepBrand, fontSize: 29, lineHeight: 34, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: theme.font.body, color: theme.textMuted, fontSize: 10, lineHeight: 15 },
  pressed: { opacity: 0.72 },
});
