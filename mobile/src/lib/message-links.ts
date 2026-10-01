import { sharedDestination } from './shared-links';
export function messageDestination(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['kampusone.app', 'links.kampusone.app', 'kampusone-mobile-preview.vercel.app'].includes(url.hostname)) return null;
    const match = /^\/s\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
    return match ? sharedDestination(match[1], match[2]) : null;
  } catch { return null; }
}
export function messageTextParts(body: string) {
  return body.split(/(https?:\/\/[^\s<>]+)/gi).filter(Boolean).map(text => ({ text, url: /^https?:\/\//i.test(text) ? text.replace(/[.,!?)]+$/, '') : null }));
}
