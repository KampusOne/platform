/** Signed web media may use the same-origin API proxy; native media stays HTTPS. */
export function learningMediaUrl(value: string | undefined, webOrigin?: string) {
  if (!value) throw new Error('This material is unavailable. Try again to refresh your access.');
  let target: URL;
  try { target = new URL(value, webOrigin); } catch { throw new Error('This material link is invalid. Reopen it to refresh your access.'); }
  const local = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const localDevelopment = webOrigin && new URL(webOrigin).protocol === 'http:' && local(new URL(webOrigin).hostname) && local(target.hostname);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && localDevelopment)) throw new Error('This material needs a secure connection. Reopen it to refresh your access.');
  return target.href;
}
