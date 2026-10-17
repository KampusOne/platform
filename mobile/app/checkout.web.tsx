import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/src/auth/auth-context';
import { pendingPayment } from '@/src/lib/hosted-payment';
import { useAppearance } from '@/src/lib/appearance';
export default function CheckoutWeb() {
  const { reference = '' } = useLocalSearchParams<{ reference?: string }>();
  const { user } = useAuth(), { theme } = useAppearance();
  const [url, setUrl] = useState('');
  useEffect(() => { let live = true; if (user) void pendingPayment(user.id).then(saved => { if (live && saved?.reference === reference && saved.authorizationUrl) setUrl(saved.authorizationUrl); }); return () => { live = false; }; }, [user, reference]);
  return <View style={{ flex: 1, backgroundColor: theme.canvas }}><Pressable style={{ padding: 20 }} onPress={() => router.replace({ pathname: '/payment-return', params: { reference } })}><Text style={{ color: theme.deepBrand }}>Close checkout and check payment</Text></Pressable>{url ? <iframe title="Secure payment" src={url} style={{ flex: 1, width: '100%', height: '85vh', border: 0 }} allow="payment"/> : null}</View>;
}
