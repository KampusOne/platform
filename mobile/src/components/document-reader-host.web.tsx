import { createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { Modal, Text, View } from 'react-native';
import { getDocumentRead, getServerDocumentRead, subscribeDocumentRead, finishDocumentRead } from '@/src/lib/document-read-session';
import { useAppearance } from '@/src/lib/appearance';
import { InlineLoading } from './skeleton';
import { ToolButton } from './toolkit';
export function DocumentReaderHost() {
  const request = useSyncExternalStore(subscribeDocumentRead, getDocumentRead, getServerDocumentRead), { theme } = useAppearance();
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!request) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      try { const data = JSON.parse(event.data); if (data.type === 'ready') frame.current?.contentWindow?.postMessage(request, window.location.origin); else if (data.id === request.id && data.type === 'result') finishDocumentRead(request.id, data.text); else if (data.id === request.id && data.type === 'error') finishDocumentRead(request.id, undefined, data.message); } catch { finishDocumentRead(request.id, undefined, 'The document could not be read. Retry your saved file.'); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [request]);
  if (!request) return null;
  return <Modal transparent visible><View style={{ flex: 1, backgroundColor: 'rgba(41,35,31,.4)', justifyContent: 'center', padding: 28 }}><View style={{ backgroundColor: theme.canvas, borderRadius: 24, padding: 26, gap: 18 }}><InlineLoading color={theme.deepBrand} /><Text style={{ fontFamily: theme.font.displayStrong, color: theme.text, fontSize: 23 }}>Reading your document</Text><Text style={{ fontFamily: theme.font.body, color: theme.textMuted }}>{request.name}</Text>
    {createElement('iframe', { ref: frame, title: 'Private document reader', srcDoc: '<!doctype html><meta name="referrer" content="no-referrer"><script src="/documents/reader.js"></script>', style: { width: 1, height: 1, border: 0, position: 'absolute', opacity: 0 }, sandbox: 'allow-scripts allow-same-origin' })}
    <ToolButton secondary label="Cancel reading" onPress={() => finishDocumentRead(request.id, undefined, 'Reading cancelled. Your document is saved.')} />
  </View></View></Modal>;
}
