import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAppearance } from '@/src/lib/appearance';
import { ToolButton } from './toolkit';
export function LearningDocument({ url, title, onRefresh }: { url: string; title: string; onRefresh?: () => void }) {
  const view = useRef<WebView>(null), { theme, isDark } = useAppearance();
  const [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  if (failed) return <View style={{ flex: 1, padding: 24, gap: 18, alignItems: 'center', justifyContent: 'center' }}>
    <Text accessibilityRole="alert" style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: 'center', lineHeight: 22 }}>The document reader could not connect. Try again when you are online.</Text>
    <ToolButton secondary label="Retry document" onPress={() => { setFailed(false); setRevision(n => n + 1); onRefresh?.(); }} />
  </View>;
  return <WebView key={revision} ref={view} source={{ uri: 'https://mobile.kampusone.app/documents/viewer.html?v=2' }} style={{ flex: 1, backgroundColor: theme.canvas }} nestedScrollEnabled bounces={false} setBuiltInZoomControls={false} setDisplayZoomControls={false} javaScriptEnabled allowFileAccess={false} mixedContentMode="never" originWhitelist={['https://mobile.kampusone.app']} onShouldStartLoadWithRequest={request => request.url.startsWith('https://mobile.kampusone.app/documents/')} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} onRenderProcessGone={() => setRevision(n => n + 1)} onMessage={event => {
    if (event.nativeEvent.data === 'ready') view.current?.injectJavaScript(`window.openLearningDocument(${JSON.stringify({ url, title, dark: isDark })});true;`);
    else if (event.nativeEvent.data === 'refresh-access') onRefresh?.();
  }} />;
}
