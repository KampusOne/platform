import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/src/auth/auth-context';
import { pendingPayment } from '@/src/lib/hosted-payment';
import { validPaymentReference } from '@/src/lib/payment-flow';
import { normalizePaymentReturn } from '../../packages/contracts/src/payment-links';
import { useAppearance } from '@/src/lib/appearance';
import { useOffline } from '@/src/lib/network-state';

export default function Checkout() {
  const { reference = '' } = useLocalSearchParams<{ reference?: string }>();
  const { user } = useAuth(), { theme } = useAppearance(), offline = useOffline();
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [progress, setProgress] = useState(0);
  const view = useRef<WebView>(null), leaving = useRef(false);
  const verify = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    // Closing a provider window only starts owned server verification.
    router.replace({ pathname: '/payment-return', params: { reference } });
  }, [reference]);
  useEffect(() => {
    let alive = true;
    if (user && validPaymentReference(reference)) void pendingPayment(user.id).then(saved => {
      if (!alive) return;
      if (saved?.reference === reference && saved.authorizationUrl) setUrl(saved.authorizationUrl);
      else verify();
    }).catch(() => { if (alive) setError('Your saved checkout could not load. Check your payment status.'); });
    return () => { alive = false; };
  }, [user, reference, verify]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { verify(); return true; });
    return () => back.remove();
  }, [verify]);
  function navigate(next: string) {
    if (normalizePaymentReturn(next)) { verify(); return false; }
    try { const parsed = new URL(next); return parsed.protocol === 'https:' && !parsed.username && !parsed.password || next === 'about:blank'; }
    catch { return false; }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }} edges={['top', 'bottom']}>
    <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close checkout and verify payment" onPress={verify} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Ionicons name="close" size={26} color={theme.text}/></Pressable>
      <Text style={{ flex: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 }}>Secure checkout</Text>
      <Pressable accessibilityRole="button" onPress={verify} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.deepBrand, fontFamily: theme.font.semibold }}>I have paid</Text></Pressable>
    </View>
    {progress < 1 ? <View accessibilityLabel="Loading secure checkout" style={{ height: 3, backgroundColor: theme.border }}><View style={{ height: 3, width: `${Math.max(3, progress * 100)}%`, backgroundColor: theme.deepBrand }}/></View> : null}
    {offline || error ? <View style={{ padding: 24, gap: 16 }}><Text accessibilityRole="alert" style={{ color: theme.text, fontFamily: theme.font.body }}>{offline ? 'You’re offline. Reconnect to continue payment. Your order is saved.' : error}</Text><Pressable accessibilityRole="button" onPress={() => { setError(''); view.current?.reload(); }} style={{ padding: 14 }}><Text style={{ color: theme.deepBrand }}>Try again</Text></Pressable><Pressable onPress={verify} accessibilityRole="button" style={{ padding: 14 }}><Text style={{ color: theme.deepBrand }}>Check payment status</Text></Pressable></View> : null}
    {url ? <WebView ref={view} source={{ uri: url }} style={{ flex: 1 }}
      onShouldStartLoadWithRequest={request => navigate(request.url)}
      onNavigationStateChange={state => { if (normalizePaymentReturn(state.url)) verify(); }}
      onLoadProgress={event => setProgress(event.nativeEvent.progress)}
      onError={() => setError('Checkout could not load. Retry or check your payment status before paying again.')}
      onHttpError={event => { if (event.nativeEvent.statusCode >= 400) setError('The payment provider could not load this page. Your order is kept.'); }}
      javaScriptEnabled domStorageEnabled cacheEnabled sharedCookiesEnabled
      mixedContentMode="never" allowFileAccess={false} setSupportMultipleWindows={false}/>: null}
  </SafeAreaView>;
}
