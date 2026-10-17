import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '@/src/lib/appearance';
export function LearningDocument({ url, title, onRefresh }: { url: string; title: string; onRefresh?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null), { isDark } = useAppearance();
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ url, title, dark: isDark }, window.location.origin);
  }, [ready, url, title, isDark]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data === 'ready') setReady(n => n + 1);
      else if (event.data === 'refresh-access') onRefresh?.();
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [onRefresh]);
  return <iframe ref={frame} title={title} src="/documents/viewer.html?v=3" onLoad={() => { if (!ready) setReady(1); }} style={{ width: '100%', height: '100%', minHeight: 0, flex: 1, border: 0, display: 'block' }} sandbox="allow-scripts allow-same-origin" />;
}
