import { useThemeStyles, type Theme } from '@/src/lib/appearance';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProfileAvatar } from './profile-avatar';
import { useAuth } from '@/src/auth/auth-context';

export type NoticeOptions = { title?: string | undefined; actor?: { id: string; name: string; imageUrl?: string | null }; dedupeKey?: string };
type Notice = NoticeOptions & { id: number; message: string; tone: 'info' | 'success' | 'error'; onOpen?: (() => void) | undefined };
type ShowNotice = (message: string, tone?: Notice['tone'], onOpen?: () => void, options?: NoticeOptions) => void;
const ToastContext = createContext<ShowNotice>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme, isDark, styles } = useThemeStyles(createStyles);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const blurTarget = useRef<View>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const sequence = useRef(0), shown = useRef(new Map<string, number>());
  const dismissGesture = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 || gesture.dy < -12,
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dx) > 32 || gesture.dy < -24) setNotice(null); },
  })).current;
  const show = useCallback<ShowNotice>((message, tone = 'info', onOpen, options = {}) => {
    if (!message.trim() && !options.title?.trim()) return;
    const now = Date.now();
    if (options.dedupeKey && now - (shown.current.get(options.dedupeKey) ?? 0) < 60_000) return;
    if (options.dedupeKey) shown.current.set(options.dedupeKey, now);
    while (shown.current.size > 80) shown.current.delete(shown.current.keys().next().value!);
    setNotice({ ...options, id: ++sequence.current, message, tone, onOpen });
  }, []);
  useEffect(() => { setNotice(null); shown.current.clear(); }, [user?.id, user?.universityId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.onOpen ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const icon = notice?.tone === 'error' ? 'alert-circle-outline' : /cart/i.test(notice?.message ?? '') ? 'bag-check-outline' : notice?.tone === 'success' ? 'checkmark-circle-outline' : 'notifications-outline';
  return <ToastContext.Provider value={show}>
    <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>{children}</BlurTargetView>
    {notice ? <View pointerEvents="box-none" style={[styles.position, { top: Math.max(12, insets.top + 8) }]}>
      <View {...dismissGesture.panHandlers} accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.toast}>
        <BlurView pointerEvents="none" blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" tint={isDark ? 'dark' : 'light'} intensity={38} style={StyleSheet.absoluteFill} />
        <Pressable accessibilityRole={notice.onOpen ? 'button' : 'text'} accessibilityLabel={[notice.title, notice.message].filter(Boolean).join('. ')} onPress={() => { if (notice.onOpen) { notice.onOpen(); setNotice(null); } }} style={styles.content}>
          {notice.actor?.id ? <ProfileAvatar name={notice.actor.name} imageUrl={notice.actor.imageUrl} size={42} /> : <View style={styles.symbol}><Ionicons name={icon} color={notice.tone === 'error' ? theme.error : notice.tone === 'success' ? theme.success : theme.accentText} size={24} /></View>}
          <View style={styles.copy}>{notice.title ? <Text numberOfLines={1} style={styles.title}>{notice.title}</Text> : null}<Text numberOfLines={notice.title ? 2 : 3} style={styles.message}>{notice.message}</Text></View>
        </Pressable>
        <Pressable accessibilityLabel="Dismiss notification" accessibilityRole="button" onPress={() => setNotice(null)} style={styles.close}><Ionicons name="close" size={18} color={theme.textMuted} /></Pressable>
      </View>
    </View> : null}
  </ToastContext.Provider>;
}
export function useToast() { return useContext(ToastContext); }
const createStyles = (theme: Theme) => StyleSheet.create({
  position: { position: 'absolute', left: 12, right: 12, zIndex: 9999, alignItems: 'center' },
  toast: { backgroundColor: theme.surfaceGlass, borderRadius: 22, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', maxWidth: 520, width: '100%', overflow: 'hidden', ...theme.shadow, elevation: 8 },
  content: { flex: 1, padding: 12, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11 }, symbol: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 4 },
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, lineHeight: 18 }, message: { color: theme.text, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }, close: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
