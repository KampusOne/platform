import { useRef, useSyncExternalStore } from 'react';
import { Modal, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getDocumentRead, getServerDocumentRead, subscribeDocumentRead, finishDocumentRead } from '@/src/lib/document-read-session';
import { useAppearance } from '@/src/lib/appearance';
import { InlineLoading } from './skeleton';
import { ToolButton } from './toolkit';
export function DocumentReaderHost() {
  const request = useSyncExternalStore(subscribeDocumentRead, getDocumentRead, getServerDocumentRead), { theme } = useAppearance();
  const web = useRef<WebView>(null);
  if (!request) return null;
  return <Modal transparent visible animationType="fade" onRequestClose={() => finishDocumentRead(request.id, undefined, 'Reading cancelled. Your document is saved.')}><View style={{ flex: 1, backgroundColor: 'rgba(41,35,31,.4)', justifyContent: 'center', padding: 28 }}><View style={{ backgroundColor: theme.canvas, borderRadius: 24, padding: 26, gap: 18 }}>
    <InlineLoading color={theme.deepBrand} /><Text style={{ fontFamily: theme.font.displayStrong, color: theme.text, fontSize: 23 }}>Reading your document</Text><Text style={{ fontFamily: theme.font.body, color: theme.textMuted, lineHeight: 22 }}>{request.name}</Text>
    <View style={{ height: 1, overflow: 'hidden' }}><WebView ref={web} source={{ uri: 'https://kampusone-mobile-preview.vercel.app/documents/reader.html' }} javaScriptEnabled originWhitelist={['https://kampusone-mobile-preview.vercel.app']} onShouldStartLoadWithRequest={r => r.url === 'about:blank' || r.url.startsWith('https://kampusone-mobile-preview.vercel.app/documents/')} onMessage={event => {
      try { const data = JSON.parse(event.nativeEvent.data); if (data.type === 'ready') web.current?.injectJavaScript(`window.readCampusDocument(${JSON.stringify(request)});true;`); else if (data.id === request.id && data.type === 'result') finishDocumentRead(request.id, data.text); else if (data.id === request.id && data.type === 'error') finishDocumentRead(request.id, undefined, data.message); } catch { finishDocumentRead(request.id, undefined, 'The document reader returned an invalid result. Retry your saved file.'); }
    }} onError={() => finishDocumentRead(request.id, undefined, 'The document reader could not connect. Retry when you are online.')} /></View>
    <ToolButton secondary label="Cancel reading" onPress={() => finishDocumentRead(request.id, undefined, 'Reading cancelled. Your document is saved.')} />
  </View></View></Modal>;
}
